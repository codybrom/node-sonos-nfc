// Owns discovery bootstrap, topology (room -> group coordinator), music-service
// lookup, and favorites/playlists. One instance is cached for the process.

import { discoverAnyPlayer } from './discovery.js';
import { Player } from './player.js';
import { PATH, URN, invoke } from './soap.js';
import { decodeEntities, getTagText, getTagBlocks, getAttr } from './xml.js';

const RADIO_PREFIXES = [
  'x-sonosapi-stream:',
  'x-sonosapi-radio:',
  'x-sonosapi-hls:',
  'x-sonosapi-hls-static:',
  'x-sonosprog-http:',
  'x-rincon-mp3radio:',
  'pndrradio:',
  'hls-radio:',
];

export class SonosSystem {
  constructor({ seedIp } = {}) {
    this._seedIp = seedIp;
    this._seedBaseUrl = seedIp ? `http://${seedIp}:1400` : null;
    this._rooms = new Map(); // lowercased room name -> { coordinatorUuid, baseUrl }
    this._spotify = null; // { id, type }
  }

  async bootstrap() {
    if (!this._seedBaseUrl) {
      const { ip } = await discoverAnyPlayer();
      this._seedBaseUrl = `http://${ip}:1400`;
    }
    await this.refreshTopology();
    return this;
  }

  async refreshTopology() {
    const res = await invoke(
      this._seedBaseUrl,
      PATH.ZoneGroupTopology,
      URN.ZoneGroupTopology,
      'GetZoneGroupState'
    );
    const state = decodeEntities(getTagText(res, 'ZoneGroupState') || '');
    const rooms = new Map();
    for (const group of getTagBlocks(state, 'ZoneGroup')) {
      const openTag = group.match(/^<ZoneGroup\b[^>]*>/)?.[0] || '';
      const coordinatorUuid = getAttr(openTag, 'Coordinator');
      const members = group.match(/<ZoneGroupMember\b[^>]*>/g) || [];
      const coordTag = members.find((m) => getAttr(m, 'UUID') === coordinatorUuid);
      if (!coordTag) continue;
      const coordBaseUrl = locationToBaseUrl(getAttr(coordTag, 'Location'));
      if (!coordBaseUrl) continue;
      for (const m of members) {
        if (getAttr(m, 'Invisible') === '1') continue; // sub/right-channel/bridge
        const name = getAttr(m, 'ZoneName');
        if (name) rooms.set(name.toLowerCase(), { coordinatorUuid, baseUrl: coordBaseUrl });
      }
    }
    if (rooms.size) this._rooms = rooms;
    return this._rooms;
  }

  // Returns the coordinator Player for a room. Refreshes topology once on a miss.
  async resolveRoom(name) {
    const key = String(name).toLowerCase();
    let entry = this._rooms.get(key);
    if (!entry) {
      await this.refreshTopology();
      entry = this._rooms.get(key);
    }
    if (!entry) {
      throw new Error(`Sonos room "${name}" not found. Known rooms: ${[...this._rooms.keys()].join(', ')}`);
    }
    return new Player({ uuid: entry.coordinatorUuid, baseUrl: entry.baseUrl });
  }

  // { id, type } for Spotify (type = (id<<8)+7), derived at runtime and cached.
  async getSpotifyService() {
    if (this._spotify) return this._spotify;
    const res = await invoke(this._seedBaseUrl, PATH.MusicServices, URN.MusicServices, 'ListAvailableServices');
    const list = decodeEntities(getTagText(res, 'AvailableServiceDescriptorList') || '');
    for (const svc of list.match(/<Service\b[^>]*>/g) || []) {
      if (getAttr(svc, 'Name') === 'Spotify') {
        const id = parseInt(getAttr(svc, 'Id'), 10);
        this._spotify = { id, type: (id << 8) + 7 };
        return this._spotify;
      }
    }
    throw new Error('Spotify is not configured in your Sonos app (no Spotify service found)');
  }

  async getFavorites() {
    return this._browseItems('FV:2');
  }
  async getPlaylists() {
    return this._browseItems('SQ:');
  }

  async _browseItems(objectId) {
    const player = await this.resolveAnyPlayer();
    const res = await player.browse(objectId);
    const didl = decodeEntities(getTagText(res, 'Result') || '');
    const items = [];
    for (const block of [...getTagBlocks(didl, 'item'), ...getTagBlocks(didl, 'container')]) {
      const title = getTagText(block, 'dc:title');
      // <res> and <r:resMD> are entity-encoded a second time inside the DIDL.
      const uri = decodeEntities(getTagText(block, 'res') || '');
      const metadata = decodeEntities(getTagText(block, 'r:resMD') || '');
      if (title) items.push({ title, uri, metadata });
    }
    return items;
  }

  async resolveAnyPlayer() {
    // Any coordinator works for read-only Browse / service listing.
    const first = this._rooms.values().next().value;
    const baseUrl = first ? first.baseUrl : this._seedBaseUrl;
    return new Player({ uuid: first?.coordinatorUuid, baseUrl });
  }

  async playFavorite(coordinator, name) {
    const fav = findByTitle(await this.getFavorites(), name);
    if (!fav) throw new Error(`Favorite "${name}" not found`);
    if (isRadio(fav.uri)) {
      await coordinator.setAVTransport(fav.uri, fav.metadata);
    } else {
      await coordinator.clearQueue();
      await coordinator.addURIToQueue(fav.uri, fav.metadata);
      await coordinator.setAVTransport(`x-rincon-queue:${coordinator.uuid}#0`);
    }
    return coordinator.play();
  }

  async playPlaylist(coordinator, name) {
    const pl = findByTitle(await this.getPlaylists(), name);
    if (!pl) throw new Error(`Playlist "${name}" not found`);
    await coordinator.clearQueue();
    await coordinator.addURIToQueue(pl.uri, '');
    await coordinator.setAVTransport(`x-rincon-queue:${coordinator.uuid}#0`);
    return coordinator.play();
  }
}

function findByTitle(items, name) {
  const n = String(name).toLowerCase();
  return items.find((i) => i.title.toLowerCase() === n);
}

function isRadio(uri) {
  return RADIO_PREFIXES.some((p) => uri.startsWith(p));
}

function locationToBaseUrl(location) {
  if (!location) return null;
  try {
    return new URL(location).origin; // http://192.168.0.195:1400
  } catch {
    return null;
  }
}
