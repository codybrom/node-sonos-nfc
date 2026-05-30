import { jest } from '@jest/globals';
import EventEmitter from './event_emitter.js';

// Native-ESM mocks must be registered before importing the module under test.
const nfcCard = {
  parseInfo: jest.fn(),
  isFormatedAsNDEF: jest.fn(),
  hasReadPermissions: jest.fn(),
  hasNDEFMessage: jest.fn(),
  getNDEFMessageLengthToRead: jest.fn(),
  parseNDEF: jest.fn(),
};
const process_sonos_command = jest.fn();

jest.unstable_mockModule('nfccard-tool', () => ({ default: nfcCard }));
jest.unstable_mockModule('../process_sonos_command.js', () => ({ default: process_sonos_command }));

const { default: sonos_nfc } = await import('../sonos_nfc.js');

describe('sonos_nfc', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('Listens for reader ready event', () => {
    const nfc = { on: jest.fn() };
    sonos_nfc(nfc);
    expect(nfc.on).toHaveBeenCalledWith('reader', expect.any(Function));
  });

  test('Calls process_sonos_command when card text message is successfully processed', async () => {
    const nfc = new EventEmitter();
    const command = 'spotify:abc123';
    const mockReader = new EventEmitter({
      read: () => Promise.resolve(command),
      reader: { name: 'Mock Reader' },
    });
    const card = { type: 'ntag', uid: '043A98CABB2B80' };

    nfcCard.isFormatedAsNDEF.mockImplementation(() => true);
    nfcCard.hasReadPermissions.mockImplementation(() => true);
    nfcCard.hasNDEFMessage.mockImplementation(() => true);
    nfcCard.parseNDEF.mockImplementation((msg) => [{ type: 'text', text: msg }]);

    sonos_nfc(nfc);
    await nfc.emit('reader', mockReader);
    await mockReader.emit('card', card);

    expect(process_sonos_command).toHaveBeenCalledWith(command);
  });

  test('Calls process_sonos_command when card URI message is successfully processed', async () => {
    const nfc = new EventEmitter();
    const command = 'spotify:abc123';
    const mockReader = new EventEmitter({
      read: () => Promise.resolve(command),
      reader: { name: 'Mock Reader' },
    });
    const card = { type: 'ntag', uid: '043A98CABB2B80' };

    nfcCard.isFormatedAsNDEF.mockImplementation(() => true);
    nfcCard.hasReadPermissions.mockImplementation(() => true);
    nfcCard.hasNDEFMessage.mockImplementation(() => true);
    nfcCard.parseNDEF.mockImplementation((msg) => [{ type: 'uri', uri: msg }]);

    sonos_nfc(nfc);
    await nfc.emit('reader', mockReader);
    await mockReader.emit('card', card);

    expect(process_sonos_command).toHaveBeenCalledWith(command);
  });

  test('Logs error message when card format is invalid', async () => {
    const log = jest.spyOn(console, 'log');
    const nfc = new EventEmitter();
    const mockReader = new EventEmitter({
      read: () => Promise.resolve({}),
      reader: { name: 'Mock Reader' },
    });
    const card = { type: 'ntag', uid: '043A98CABB2B80' };

    sonos_nfc(nfc);
    await nfc.emit('reader', mockReader);
    await mockReader.emit('card', card);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Could not parse anything from this tag')
    );
  });

  test('Logs message when card is removed', async () => {
    const log = jest.spyOn(console, 'log');
    const nfc = new EventEmitter();
    const mockReader = new EventEmitter({
      read: jest.fn(() => Promise.resolve(Buffer.alloc(0))),
      reader: { name: 'Mock Reader' },
    });
    const card = { type: 'ntag', uid: '043A98CABB2B80' };

    sonos_nfc(nfc);
    await nfc.emit('reader', mockReader);
    await mockReader.emit('card.off', card);

    expect(log).toHaveBeenNthCalledWith(
      3,
      `${mockReader.reader.name}: ${card.type} with UID ${card.uid} removed`
    );
  });

  test('Logs error message when card can’t be read', async () => {
    const log = jest.spyOn(console, 'error');
    const nfc = new EventEmitter();
    const error = 'Nope, did not work';
    const mockReader = new EventEmitter({
      read: () => Promise.reject(error),
      reader: { name: 'Mock Reader' },
    });
    const card = { type: 'ntag', uid: '043A98CABB2B80' };

    sonos_nfc(nfc);
    await nfc.emit('reader', mockReader);
    await mockReader.emit('card', card);

    expect(log).toHaveBeenCalledWith(error);
  });

  test('Logs message when reader throws error', async () => {
    const log = jest.spyOn(console, 'log');
    const nfc = new EventEmitter();
    const mockReader = new EventEmitter({
      read: jest.fn(() => Promise.resolve(Buffer.alloc(0))),
      reader: { name: 'Mock Reader' },
    });
    const error = 'Nope, did not work';

    sonos_nfc(nfc);
    await nfc.emit('reader', mockReader);
    await mockReader.emit('error', error);

    expect(log).toHaveBeenNthCalledWith(3, `${mockReader.reader.name} an error occurred`, error);
  });

  test('Logs message when reader is disconnected', async () => {
    const log = jest.spyOn(console, 'log');
    const nfc = new EventEmitter();
    const mockReader = new EventEmitter({
      read: jest.fn(() => Promise.resolve(Buffer.alloc(0))),
      reader: { name: 'Mock Reader' },
    });

    sonos_nfc(nfc);
    await nfc.emit('reader', mockReader);
    await mockReader.emit('end');

    expect(log).toHaveBeenNthCalledWith(3, `${mockReader.reader.name} device removed`);
  });

  test('Logs message when NFC library returns error', async () => {
    const log = jest.spyOn(console, 'log');
    const nfc = new EventEmitter();
    const error = 'Nope, did not work';

    sonos_nfc(nfc);
    await nfc.emit('error', error);

    expect(log).toHaveBeenNthCalledWith(2, 'an NFC error occurred', error);
  });
});
