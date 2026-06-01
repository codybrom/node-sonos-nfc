// Owns discovery bootstrap, topology (room -> group coordinator), the Spotify
// service lookup, and Spotify-account discovery. One instance cached per process.

import { discoverAnyPlayer } from './discovery.ts';
import { Player } from './player.ts';
import { invoke, PATH, URN } from './soap.ts';
import { decodeEntities, getAttr, getTagBlocks, getTagText } from './xml.ts';

export interface SpotifyService {
  id: number;
  type: number;
}
export interface MediaItem {
  title: string;
  uri: string;
  metadata: string;
}
// A linked Spotify account discovered from favorites/queues. `sn` is the value
// for `spotify_account_sn` (null if no playable item revealed it); `token` is
// the Sonos account token; `examples` are tracks under it, for recognition.
export interface SpotifyAccount {
  token: string | null;
  sn: number | null;
  examples: string[];
}

// A room and the group coordinator that controls it. `name` keeps the original
// casing for display; the map is keyed by the lowercased name for lookup.
interface Zone {
  coordinatorUuid: string;
  baseUrl: string;
  name: string;
}

export class SonosSystem {
  private _seedBaseUrl: string | null;
  private _rooms = new Map<string, Zone>();
  private _spotify: SpotifyService | null = null;

  constructor({ seedIp }: { seedIp?: string } = {}) {
    this._seedBaseUrl = seedIp ? `http://${seedIp}:1400` : null;
  }

  async bootstrap(): Promise<this> {
    if (!this._seedBaseUrl) {
      const { ip } = await discoverAnyPlayer();
      this._seedBaseUrl = `http://${ip}:1400`;
    }
    // A player in network sleep can miss the first request; retry a few times
    // (each attempt also helps wake it) before giving up.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await this.refreshTopology();
        return this;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw lastErr;
  }

  async refreshTopology(): Promise<Map<string, Zone>> {
    const res = await invoke(
      this._seedBaseUrl!,
      PATH.ZoneGroupTopology,
      URN.ZoneGroupTopology,
      'GetZoneGroupState',
    );
    const state = decodeEntities(getTagText(res, 'ZoneGroupState') || '');
    const rooms = new Map<string, Zone>();
    for (const group of getTagBlocks(state, 'ZoneGroup')) {
      const openTag = group.match(/^<ZoneGroup\b[^>]*>/)?.[0] || '';
      const coordinatorUuid = getAttr(openTag, 'Coordinator');
      const members = group.match(/<ZoneGroupMember\b[^>]*>/g) || [];
      const coordTag = members.find(
        (m) => getAttr(m, 'UUID') === coordinatorUuid,
      );
      if (!coordTag || !coordinatorUuid) continue;
      const coordBaseUrl = locationToBaseUrl(getAttr(coordTag, 'Location'));
      if (!coordBaseUrl) continue;
      for (const m of members) {
        if (getAttr(m, 'Invisible') === '1') continue; // sub/right-channel/bridge
        const name = getAttr(m, 'ZoneName');
        if (name) {
          rooms.set(name.toLowerCase(), {
            coordinatorUuid,
            baseUrl: coordBaseUrl,
            name,
          });
        }
      }
    }
    if (rooms.size) this._rooms = rooms;
    return this._rooms;
  }

  // Returns the coordinator Player for a room. Refreshes topology once on a miss.
  async resolveRoom(name: string): Promise<Player> {
    const key = String(name).toLowerCase();
    let entry = this._rooms.get(key);
    if (!entry) {
      await this.refreshTopology();
      entry = this._rooms.get(key);
    }
    if (!entry) {
      throw new Error(
        `Sonos room "${name}" not found. Known rooms: ${[...this._rooms.keys()].join(', ')}`,
      );
    }
    return new Player({ uuid: entry.coordinatorUuid, baseUrl: entry.baseUrl });
  }

  // Every room name (original casing) with the IP of its group coordinator,
  // sorted by name — for the `status` setup helper.
  listRooms(): { name: string; ip: string }[] {
    return [...this._rooms.values()]
      .map((z) => ({ name: z.name, ip: hostOf(z.baseUrl) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // The IP tapdeck is talking to (discovered or seeded) — a candidate for
  // `sonos_seed_ip`. Null until bootstrap has run.
  get connectedIp(): string | null {
    return this._seedBaseUrl ? hostOf(this._seedBaseUrl) : null;
  }

  // { id, type } for Spotify (type = (id<<8)+7), derived at runtime and cached.
  async getSpotifyService(): Promise<SpotifyService> {
    if (this._spotify) return this._spotify;
    const res = await invoke(
      this._seedBaseUrl!,
      PATH.MusicServices,
      URN.MusicServices,
      'ListAvailableServices',
    );
    const list = decodeEntities(
      getTagText(res, 'AvailableServiceDescriptorList') || '',
    );
    for (const svc of list.match(/<Service\b[^>]*>/g) || []) {
      if (getAttr(svc, 'Name') === 'Spotify') {
        const id = parseInt(getAttr(svc, 'Id') || '', 10);
        this._spotify = { id, type: (id << 8) + 7 };
        return this._spotify;
      }
    }
    throw new Error(
      'Spotify is not configured in your Sonos app (no Spotify service found)',
    );
  }

  // Browse the household's "My Sonos" favorites. Kept (even though tapdeck plays
  // Spotify only) because `getSpotifyAccounts` mines favorite metadata for the
  // Spotify account serial numbers.
  getFavorites(): Promise<MediaItem[]> {
    return this._browseItems('FV:2');
  }

  // The linked Spotify accounts discovered from the user's favorites, so they
  // can pick one for `spotify_account_sn`. Each account is keyed by its Sonos
  // account token (the `-<token>-` in the favorite's cdudn metadata — the only
  // stable per-account identifier available locally, since S2 doesn't expose
  // usernames over the LAN), with the `sn` serial number to put in the setting
  // (null if no favorite under it has a playable `sn=` URI) and the favorites
  // that belong to it for recognition. Sorted with known-`sn` accounts first.
  async getSpotifyAccounts(): Promise<SpotifyAccount[]> {
    const { id, type } = await this.getSpotifyService();
    const tokenRe = new RegExp(`SA_RINCON${type}_X_#Svc${type}-([^-]+)-Token`);
    const sidRe = new RegExp(`[?&]sid=${id}(?:&|$)`);

    // Favorites are household-wide; queues are per-coordinator, so also scan
    // each group's queue. A queued Spotify track carries `sn=` directly, which
    // can reveal an account (and its serial number) that no favorite does.
    const items: MediaItem[] = [...await this.getFavorites()];
    const seen = new Set<string>();
    for (const { coordinatorUuid, baseUrl } of this._rooms.values()) {
      if (seen.has(baseUrl)) continue; // one queue per coordinator
      seen.add(baseUrl);
      try {
        items.push(
          ...await this._browseItems(
            'Q:0',
            new Player({ uuid: coordinatorUuid, baseUrl }),
          ),
        );
      } catch {
        // a group with an empty or unreachable queue — skip it
      }
    }

    // Each item may carry a token (from metadata), an sn (from the URI), or
    // both — favorites tend to have the token, queue tracks the sn. Collect the
    // raw signals first.
    const raw: { token: string | null; sn: number | null; title: string }[] = [];
    for (const item of items) {
      const tokenMatch = item.metadata.match(tokenRe);
      const isSpotify = sidRe.test(item.uri);
      if (!tokenMatch && !isSpotify) continue;
      const snMatch = isSpotify ? item.uri.match(/[?&]sn=(\d+)/) : null;
      raw.push({
        token: tokenMatch ? tokenMatch[1]! : null,
        sn: snMatch ? parseInt(snMatch[1]!, 10) : null,
        title: item.title,
      });
    }

    // An account is uniquely identified by its sn, so learn token→sn from items
    // that expose both, then group by sn (falling back to token when no sn is
    // known anywhere). This merges, say, a token-less queued track into the
    // account a favorite established under the same sn.
    const tokenToSn = new Map<string, number>();
    for (const r of raw) if (r.token && r.sn !== null) tokenToSn.set(r.token, r.sn);

    const accounts = new Map<
      string,
      { token: string | null; sn: number | null; examples: Set<string> }
    >();
    for (const r of raw) {
      const sn = r.sn ?? (r.token ? tokenToSn.get(r.token) ?? null : null);
      const key = sn !== null ? `sn:${sn}` : `token:${r.token}`;
      const acc = accounts.get(key) ??
        { token: null, sn: null, examples: new Set<string>() };
      if (sn !== null) acc.sn = sn;
      if (r.token) acc.token = r.token;
      if (r.title) acc.examples.add(r.title);
      accounts.set(key, acc);
    }
    return [...accounts.values()]
      .map((a) => ({ token: a.token, sn: a.sn, examples: [...a.examples] }))
      .sort((a, b) => (a.sn ?? Infinity) - (b.sn ?? Infinity));
  }

  private async _browseItems(
    objectId: string,
    player: Player = this.resolveAnyPlayer(),
  ): Promise<MediaItem[]> {
    const res = await player.browse(objectId);
    const didl = decodeEntities(getTagText(res, 'Result') || '');
    const items: MediaItem[] = [];
    for (
      const block of [
        ...getTagBlocks(didl, 'item'),
        ...getTagBlocks(didl, 'container'),
      ]
    ) {
      // The title, <res>, and <r:resMD> are each entity-encoded a second time
      // inside the DIDL, so decode them — titles like `Don&apos;t Start Now`
      // would otherwise show their raw entities in `status`/`setup` output.
      const title = decodeEntities(getTagText(block, 'dc:title') || '');
      const uri = decodeEntities(getTagText(block, 'res') || '');
      const metadata = decodeEntities(getTagText(block, 'r:resMD') || '');
      if (title) items.push({ title, uri, metadata });
    }
    return items;
  }

  resolveAnyPlayer(): Player {
    // Any coordinator works for read-only Browse / service listing.
    const first = this._rooms.values().next().value;
    const baseUrl = first ? first.baseUrl : this._seedBaseUrl!;
    return new Player({ uuid: first?.coordinatorUuid ?? '', baseUrl });
  }
}

function locationToBaseUrl(location: string | undefined): string | null {
  if (!location) return null;
  try {
    return new URL(location).origin; // http://192.168.0.195:1400
  } catch {
    return null;
  }
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}
