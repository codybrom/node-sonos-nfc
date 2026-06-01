// A Sonos coordinator we can send transport/rendering commands to. Each method
// is a single SOAP call (plus a tiny parse where we need a value back).

import { invoke, PATH, URN } from './soap.ts';
import { encodeEntities, getTagText } from './xml.ts';

type Repeat = 'none' | 'all' | 'one';

// Sonos encodes repeat+shuffle as one combined PlayMode string. Map both ways so
// callers can flip one dimension without clobbering the other.
const PLAYMODE: Record<string, { shuffle: boolean; repeat: Repeat }> = {
  NORMAL: { shuffle: false, repeat: 'none' },
  REPEAT_ALL: { shuffle: false, repeat: 'all' },
  REPEAT_ONE: { shuffle: false, repeat: 'one' },
  SHUFFLE_NOREPEAT: { shuffle: true, repeat: 'none' },
  SHUFFLE: { shuffle: true, repeat: 'all' },
  SHUFFLE_REPEAT_ONE: { shuffle: true, repeat: 'one' },
};

function encodePlayMode({
  shuffle,
  repeat,
}: {
  shuffle: boolean;
  repeat: Repeat;
}): string {
  for (const [name, v] of Object.entries(PLAYMODE)) {
    if (v.shuffle === shuffle && v.repeat === repeat) return name;
  }
  return 'NORMAL';
}

export class Player {
  readonly uuid: string;
  readonly baseUrl: string;

  constructor({ uuid, baseUrl }: { uuid: string; baseUrl: string }) {
    this.uuid = uuid;
    this.baseUrl = baseUrl;
  }

  private _av(
    action: string,
    args = '<InstanceID>0</InstanceID>',
    opts?: { timeout?: number },
  ): Promise<string> {
    return invoke(
      this.baseUrl,
      PATH.AVTransport,
      URN.AVTransport,
      action,
      args,
      opts,
    );
  }
  private _rc(action: string, args: string): Promise<string> {
    return invoke(
      this.baseUrl,
      PATH.RenderingControl,
      URN.RenderingControl,
      action,
      args,
    );
  }

  play(): Promise<string> {
    return this._av('Play', '<InstanceID>0</InstanceID><Speed>1</Speed>');
  }
  pause(): Promise<string> {
    return this._av('Pause');
  }
  nextTrack(): Promise<string> {
    return this._av('Next');
  }
  previousTrack(): Promise<string> {
    return this._av('Previous');
  }
  clearQueue(): Promise<string> {
    return this._av('RemoveAllTracksFromQueue');
  }
  trackSeek(trackNr: number): Promise<string> {
    return this._av(
      'Seek',
      `<InstanceID>0</InstanceID><Unit>TRACK_NR</Unit><Target>${trackNr}</Target>`,
    );
  }
  setCrossfade(on: boolean): Promise<string> {
    return this._av(
      'SetCrossfadeMode',
      `<InstanceID>0</InstanceID><CrossfadeMode>${on ? 1 : 0}</CrossfadeMode>`,
    );
  }

  setVolume(volume: number | string): Promise<string> {
    const v = Math.max(0, Math.min(100, parseInt(String(volume), 10) || 0));
    return this._rc(
      'SetVolume',
      `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${v}</DesiredVolume>`,
    );
  }
  mute(on = true): Promise<string> {
    return this._rc(
      'SetMute',
      `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${on ? 1 : 0}</DesiredMute>`,
    );
  }
  unMute(): Promise<string> {
    return this.mute(false);
  }
  async getVolume(): Promise<number> {
    const res = await this._rc(
      'GetVolume',
      '<InstanceID>0</InstanceID><Channel>Master</Channel>',
    );
    return parseInt(getTagText(res, 'CurrentVolume') || '0', 10);
  }

  // PlayMode is packed (repeat+shuffle); these stay private because callers only
  // ever want to flip one dimension, which setRepeat/setShuffle below expose.
  private async _getPlayMode(): Promise<string> {
    const res = await this._av('GetTransportSettings');
    return getTagText(res, 'PlayMode') || 'NORMAL';
  }
  private _setPlayMode(mode: string): Promise<string> {
    return this._av(
      'SetPlayMode',
      `<InstanceID>0</InstanceID><NewPlayMode>${mode}</NewPlayMode>`,
    );
  }
  // Flip only the repeat dimension, preserving shuffle.
  async setRepeat(repeat: Repeat): Promise<string> {
    const cur = PLAYMODE[await this._getPlayMode()] ?? {
      shuffle: false,
      repeat: 'none' as Repeat,
    };
    return this._setPlayMode(encodePlayMode({ shuffle: cur.shuffle, repeat }));
  }
  // Flip only the shuffle dimension, preserving repeat.
  async setShuffle(shuffle: boolean): Promise<string> {
    const cur = PLAYMODE[await this._getPlayMode()] ?? {
      shuffle: false,
      repeat: 'none' as Repeat,
    };
    return this._setPlayMode(encodePlayMode({ shuffle, repeat: cur.repeat }));
  }

  async getTransportState(): Promise<string> {
    const res = await this._av('GetTransportInfo');
    return getTagText(res, 'CurrentTransportState') || 'STOPPED';
  }
  async playPause(): Promise<string> {
    const state = await this.getTransportState();
    return state === 'PLAYING' ? this.pause() : this.play();
  }

  // Queue/transport-URI operations contact the music service and can be slow,
  // so they get a longer timeout than plain transport commands.
  setAVTransport(uri: string, metadata = ''): Promise<string> {
    return this._av(
      'SetAVTransportURI',
      `<InstanceID>0</InstanceID><CurrentURI>${encodeEntities(uri)}</CurrentURI>` +
        `<CurrentURIMetaData>${encodeEntities(metadata)}</CurrentURIMetaData>`,
      { timeout: 12000 },
    );
  }

  // Returns the FirstTrackNumberEnqueued reported by Sonos.
  async addURIToQueue(
    uri: string,
    metadata = '',
    enqueueAsNext = false,
    desiredFirstTrack = 0,
  ): Promise<number> {
    const res = await this._av(
      'AddURIToQueue',
      `<InstanceID>0</InstanceID><EnqueuedURI>${encodeEntities(uri)}</EnqueuedURI>` +
        `<EnqueuedURIMetaData>${encodeEntities(metadata)}</EnqueuedURIMetaData>` +
        `<DesiredFirstTrackNumberEnqueued>${desiredFirstTrack}</DesiredFirstTrackNumberEnqueued>` +
        `<EnqueueAsNext>${enqueueAsNext ? 1 : 0}</EnqueueAsNext>`,
      { timeout: 12000 },
    );
    return parseInt(getTagText(res, 'FirstTrackNumberEnqueued') || '1', 10);
  }

  // The transport URI for this coordinator's own queue (track 0). Owning the
  // `x-rincon-queue:` scheme here keeps queue-addressing detail out of callers.
  queueUri(): string {
    return `x-rincon-queue:${this.uuid}#0`;
  }

  // Raw ContentDirectory Browse; caller parses the <Result> DIDL.
  browse(objectId: string, startIndex = 0, count = 0): Promise<string> {
    return invoke(
      this.baseUrl,
      PATH.ContentDirectory,
      URN.ContentDirectory,
      'Browse',
      `<ObjectID>${objectId}</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag>` +
        `<Filter>*</Filter><StartingIndex>${startIndex}</StartingIndex>` +
        `<RequestedCount>${count}</RequestedCount><SortCriteria></SortCriteria>`,
    );
  }
}
