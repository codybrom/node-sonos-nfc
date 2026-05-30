// A Sonos coordinator we can send transport/rendering commands to. Each method
// is a single SOAP call (plus a tiny parse where we need a value back).

import { PATH, URN, invoke } from './soap.js';
import { encodeEntities, getTagText } from './xml.js';

// Sonos encodes repeat+shuffle as one combined PlayMode string. Map both ways so
// callers can flip one dimension without clobbering the other.
const PLAYMODE = {
  NORMAL: { shuffle: false, repeat: 'none' },
  REPEAT_ALL: { shuffle: false, repeat: 'all' },
  REPEAT_ONE: { shuffle: false, repeat: 'one' },
  SHUFFLE_NOREPEAT: { shuffle: true, repeat: 'none' },
  SHUFFLE: { shuffle: true, repeat: 'all' },
  SHUFFLE_REPEAT_ONE: { shuffle: true, repeat: 'one' },
};

function encodePlayMode({ shuffle, repeat }) {
  for (const [name, v] of Object.entries(PLAYMODE)) {
    if (v.shuffle === shuffle && v.repeat === repeat) return name;
  }
  return 'NORMAL';
}

export class Player {
  constructor({ uuid, baseUrl }) {
    this.uuid = uuid;
    this.baseUrl = baseUrl;
  }

  _av(action, args = '<InstanceID>0</InstanceID>', opts) {
    return invoke(this.baseUrl, PATH.AVTransport, URN.AVTransport, action, args, opts);
  }
  _rc(action, args) {
    return invoke(this.baseUrl, PATH.RenderingControl, URN.RenderingControl, action, args);
  }

  play() {
    return this._av('Play', '<InstanceID>0</InstanceID><Speed>1</Speed>');
  }
  pause() {
    return this._av('Pause');
  }
  nextTrack() {
    return this._av('Next');
  }
  previousTrack() {
    return this._av('Previous');
  }
  clearQueue() {
    return this._av('RemoveAllTracksFromQueue');
  }
  trackSeek(trackNr) {
    return this._av('Seek', `<InstanceID>0</InstanceID><Unit>TRACK_NR</Unit><Target>${trackNr}</Target>`);
  }
  setCrossfade(on) {
    return this._av('SetCrossfadeMode', `<InstanceID>0</InstanceID><CrossfadeMode>${on ? 1 : 0}</CrossfadeMode>`);
  }

  setVolume(volume) {
    const v = Math.max(0, Math.min(100, parseInt(volume, 10) || 0));
    return this._rc('SetVolume', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${v}</DesiredVolume>`);
  }
  mute(on = true) {
    return this._rc('SetMute', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${on ? 1 : 0}</DesiredMute>`);
  }
  unMute() {
    return this.mute(false);
  }
  async getVolume() {
    const res = await this._rc('GetVolume', '<InstanceID>0</InstanceID><Channel>Master</Channel>');
    return parseInt(getTagText(res, 'CurrentVolume') || '0', 10);
  }

  async getPlayMode() {
    const res = await this._av('GetTransportSettings');
    return getTagText(res, 'PlayMode') || 'NORMAL';
  }
  async setPlayMode(mode) {
    return this._av('SetPlayMode', `<InstanceID>0</InstanceID><NewPlayMode>${mode}</NewPlayMode>`);
  }
  // Flip only the repeat dimension, preserving shuffle.
  async setRepeat(repeat) {
    const cur = PLAYMODE[await this.getPlayMode()] || PLAYMODE.NORMAL;
    return this.setPlayMode(encodePlayMode({ shuffle: cur.shuffle, repeat }));
  }
  // Flip only the shuffle dimension, preserving repeat.
  async setShuffle(shuffle) {
    const cur = PLAYMODE[await this.getPlayMode()] || PLAYMODE.NORMAL;
    return this.setPlayMode(encodePlayMode({ shuffle, repeat: cur.repeat }));
  }

  async getTransportState() {
    const res = await this._av('GetTransportInfo');
    return getTagText(res, 'CurrentTransportState') || 'STOPPED';
  }
  async playPause() {
    const state = await this.getTransportState();
    return state === 'PLAYING' ? this.pause() : this.play();
  }

  // Queue/transport-URI operations contact the music service and can be slow,
  // so they get a longer timeout than plain transport commands.
  setAVTransport(uri, metadata = '') {
    return this._av(
      'SetAVTransportURI',
      `<InstanceID>0</InstanceID><CurrentURI>${encodeEntities(uri)}</CurrentURI>` +
        `<CurrentURIMetaData>${encodeEntities(metadata)}</CurrentURIMetaData>`,
      { timeout: 12000 }
    );
  }

  // Returns the FirstTrackNumberEnqueued reported by Sonos.
  async addURIToQueue(uri, metadata = '', enqueueAsNext = false, desiredFirstTrack = 0) {
    const res = await this._av(
      'AddURIToQueue',
      `<InstanceID>0</InstanceID><EnqueuedURI>${encodeEntities(uri)}</EnqueuedURI>` +
        `<EnqueuedURIMetaData>${encodeEntities(metadata)}</EnqueuedURIMetaData>` +
        `<DesiredFirstTrackNumberEnqueued>${desiredFirstTrack}</DesiredFirstTrackNumberEnqueued>` +
        `<EnqueueAsNext>${enqueueAsNext ? 1 : 0}</EnqueueAsNext>`,
      { timeout: 12000 }
    );
    return parseInt(getTagText(res, 'FirstTrackNumberEnqueued') || '1', 10);
  }

  // Raw ContentDirectory Browse; caller parses the <Result> DIDL.
  browse(objectId, startIndex = 0, count = 0) {
    return invoke(
      this.baseUrl,
      PATH.ContentDirectory,
      URN.ContentDirectory,
      'Browse',
      `<ObjectID>${objectId}</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag>` +
        `<Filter>*</Filter><StartingIndex>${startIndex}</StartingIndex>` +
        `<RequestedCount>${count}</RequestedCount><SortCriteria></SortCriteria>`
    );
  }
}
