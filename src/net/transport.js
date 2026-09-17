/**
 * WebRTC data channels with a relay fallback.
 */
/**
 * How a transport reports back to the co-op layer.
 *
 * @typedef {object} TransportOptions
 * @property {string}  id                                    this peer's room-scoped id
 * @property {string}  signal                                signalling server URL
 * @property {RTCIceServer[]} [iceServers]                    ICE servers for peer connections
 * @property {boolean} [relayOnly]                           bypass WebRTC and relay via the server
 * @property {(up: boolean) => void} [onSignal]              signalling link came up or went down
 * @property {(link: any) => void} [onChannel]               a link's data channel became usable
 * @property {(message: string) => void} [onError]           a fatal, user-facing failure
 * @property {(peer: string, wasOpen: boolean) => void} [onClose] a peer went away
 */

export class LanceTransport {
  /** @type {string} */ id;
  /** @type {string} */ signal;
  /** @type {RTCIceServer[]|undefined} */ iceServers;
  /** @type {boolean|undefined} */ relayOnly;
  /** @type {((up: boolean) => void)|undefined} */ onSignal;
  /** @type {((link: any) => void)|undefined} */ onChannel;
  /** @type {((message: string) => void)|undefined} */ onError;
  /** @type {((peer: string, wasOpen: boolean) => void)|undefined} */ onClose;

  /** @param {TransportOptions} options */
  constructor({ id, signal, iceServers, relayOnly, onSignal, onChannel, onError, onClose }) {
    Object.assign(this, {
      id,
      signal,
      iceServers,
      relayOnly,
      onSignal,
      onChannel,
      onError,
      onClose,
    });
    this.links = new Map();
    this.pendingICE = new Map();
    this.closed = false;
    this.ws = null;
    this.heartbeat = null;
    this.retry = null;
    this.generation = 0;
    this.token = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random();
  }
  async open() {
    if (!window.RTCPeerConnection)
      throw Error('This browser does not support WebRTC data connections.');
    this.closed = false;
    const generation = ++this.generation;
    return new Promise((resolve, reject) => {
      let settled = false;
      const endpoint = new URL(this.signal);
      if (!['ws:', 'wss:'].includes(endpoint.protocol)) {
        reject(Error('Use a ws:// or wss:// signal server address.'));
        return;
      }
      endpoint.searchParams.set('key', endpoint.searchParams.get('key') || 'peerjs');
      endpoint.searchParams.set('id', this.id);
      endpoint.searchParams.set('token', this.token);
      endpoint.searchParams.set('version', '1.5.5');
      const ws = (this.ws = new WebSocket(endpoint.href)),
        fail = (message) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(Error(message));
        };
      const timeout = setTimeout(() => {
        fail('The signal server did not respond. Check your connection, then try again.');
        ws.close();
      }, 14000);
      ws.onmessage = async (event) => {
        if (
          this.closed ||
          generation !== this.generation ||
          typeof event.data !== 'string' ||
          event.data.length > 200000
        )
          return;
        let m;
        try {
          m = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        if (m.type === 'OPEN') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve(this);
          }
          clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => this.sendSignal({ type: 'HEARTBEAT' }), 5000);
          this.onSignal?.(true);
          return;
        }
        if (['ID-TAKEN', 'INVALID-KEY', 'ERROR'].includes(m.type)) {
          const text =
            m.type === 'ID-TAKEN'
              ? 'This room code is already in use. Create another room.'
              : 'The signal server rejected this connection.';
          fail(text);
          this.onError?.(text);
          return;
        }
        if (m.type === 'EXPIRE') {
          this.onError?.(
            'Room not found. Check the code and make sure the host is still in the lobby.',
          );
          return;
        }
        try {
          await this.receiveSignal(m);
        } catch (e) {
          this.onError?.('Connection setup failed: ' + e.message);
        }
      };
      ws.onerror = () =>
        fail('Cannot reach the signal server. Check your network or use a private signal server.');
      ws.onclose = () => {
        clearInterval(this.heartbeat);
        fail('The signal server closed the connection.');
        if (this.closed || generation !== this.generation) return;
        this.onSignal?.(false);
        // Existing data channels survive a signal-server outage.
        if ([...this.links.values()].some((l) => l.dc?.readyState === 'open'))
          this.retry = setTimeout(() => {
            if (!this.closed)
              this.open().catch(() =>
                this.onError?.('Signal server is unavailable. Connected pilots can keep playing.'),
              );
          }, 3000);
      };
    });
  }
  sendSignal(message) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
  makeLink(remoteId, connectionId) {
    if (this.links.has(remoteId)) return this.links.get(remoteId);
    if (this.links.size >= 6) throw Error('Too many connection attempts.');
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.relayOnly ? 'relay' : 'all',
    });
    const link = {
      id: remoteId,
      connectionId,
      pc,
      dc: null,
      open: false,
      closed: false,
      ice: [],
      lastSeen: performance.now(),
      rtt: 0,
      bytesOut: 0,
      bytesIn: 0,
      route: 'CHECKING',
    };
    this.links.set(remoteId, link);
    link.timeout = setTimeout(() => {
      if (!link.open) {
        this.drop(remoteId);
        this.onError?.(
          'The room was found, but the data connection failed. Try a TURN relay in Network Settings.',
        );
      }
    }, 24000);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        this.sendSignal({
          type: 'CANDIDATE',
          dst: remoteId,
          payload: { type: 'data', connectionId, candidate: e.candidate.toJSON() },
        });
    };
    pc.ondatachannel = (e) => this.bindChannel(link, e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(remoteId);
    };
    return link;
  }
  async connect(remoteId) {
    const connectionId = 'rw4-' + Math.random().toString(36).slice(2),
      link = this.makeLink(remoteId, connectionId);
    this.bindChannel(link, link.pc.createDataChannel('robotwarrior-v4', { ordered: true }));
    await link.pc.setLocalDescription(await link.pc.createOffer());
    this.sendSignal({
      type: 'OFFER',
      dst: remoteId,
      payload: {
        type: 'data',
        connectionId,
        label: 'robotwarrior-v4',
        reliable: true,
        serialization: 'json',
        sdp: link.pc.localDescription.toJSON(),
      },
    });
  }
  async receiveSignal(m) {
    if (!m.src || !m.payload || !['OFFER', 'ANSWER', 'CANDIDATE'].includes(m.type)) return;
    const p = m.payload;
    if (p.type !== 'data' || typeof p.connectionId !== 'string') return;
    let link = this.links.get(m.src);
    if (m.type === 'OFFER') {
      if (link) {
        if (link.open) return;
        this.drop(m.src, false);
      }
      link = this.makeLink(m.src, p.connectionId);
      await link.pc.setRemoteDescription(p.sdp);
      const waiting = this.pendingICE.get(m.src) || [];
      this.pendingICE.delete(m.src);
      for (const c of waiting) await link.pc.addIceCandidate(c);
      await link.pc.setLocalDescription(await link.pc.createAnswer());
      this.sendSignal({
        type: 'ANSWER',
        dst: m.src,
        payload: {
          type: 'data',
          connectionId: p.connectionId,
          sdp: link.pc.localDescription.toJSON(),
        },
      });
    } else if (m.type === 'ANSWER' && link) {
      if (link.connectionId !== p.connectionId) return;
      await link.pc.setRemoteDescription(p.sdp);
      for (const c of link.ice.splice(0)) await link.pc.addIceCandidate(c);
    } else if (m.type === 'CANDIDATE' && p.candidate) {
      if (!link) {
        if (this.pendingICE.size > 6) return;
        const queue = this.pendingICE.get(m.src) || [];
        if (queue.length < 32) queue.push(p.candidate);
        this.pendingICE.set(m.src, queue);
      } else if (link.connectionId === p.connectionId) {
        if (link.pc.remoteDescription) await link.pc.addIceCandidate(p.candidate);
        else if (link.ice.length < 32) link.ice.push(p.candidate);
      }
    }
  }
  bindChannel(link, dc) {
    if (link.dc && link.dc !== dc) {
      dc.close();
      return;
    }
    link.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 16384;
    dc.onopen = () => {
      if (this.closed) return;
      clearTimeout(link.timeout);
      link.open = true;
      link.lastSeen = performance.now();
      this.onChannel?.(link);
      this.inspectRoute(link);
    };
    dc.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > 65536) {
        this.drop(link.id);
        return;
      }
      link.lastSeen = performance.now();
      link.bytesIn += e.data.length;
      let packet;
      try {
        packet = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      if (packet && typeof packet === 'object') link.onData?.(packet);
    };
    dc.onclose = () => this.drop(link.id);
    dc.onerror = () => this.drop(link.id);
  }
  async inspectRoute(link) {
    try {
      const stats = await link.pc.getStats();
      let pair;
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId)
          pair = stats.get(s.selectedCandidatePairId);
      });
      if (!pair)
        stats.forEach((s) => {
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) pair = s;
        });
      if (pair) {
        const a = stats.get(pair.localCandidateId),
          b = stats.get(pair.remoteCandidateId);
        link.route =
          a?.candidateType === 'relay' || b?.candidateType === 'relay' ? 'RELAY' : 'DIRECT';
        if (pair.currentRoundTripTime) link.rtt = Math.round(pair.currentRoundTripTime * 1000);
      }
    } catch (_) {}
  }
  send(id, message, essential = false) {
    const l = this.links.get(id);
    if (!l?.open || l.dc.readyState !== 'open') return false;
    if (l.dc.bufferedAmount > (essential ? 512000 : 128000)) {
      if (essential) this.drop(id);
      return false;
    }
    try {
      const text = JSON.stringify(message);
      if (text.length > 65536) throw Error('Packet exceeds 64 KB.');
      l.dc.send(text);
      l.bytesOut += text.length;
      return true;
    } catch (_) {
      this.drop(id);
      return false;
    }
  }
  drop(id, notify = true) {
    const l = this.links.get(id);
    if (!l || l.closed) return;
    l.closed = true;
    clearTimeout(l.timeout);
    this.links.delete(id);
    this.pendingICE.delete(id);
    l.dc?.close();
    l.pc.close();
    if (notify) this.onClose?.(id, l.open);
  }
  close() {
    this.closed = true;
    ++this.generation;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    for (const id of [...this.links.keys()]) this.drop(id, false);
    this.ws?.close();
    this.ws = null;
    this.pendingICE.clear();
  }
}

export class LanceRelayTransport {
  /** @type {string} */ id;
  /** @type {string} */ signal;
  /** @type {RTCIceServer[]|undefined} */ iceServers;
  /** @type {boolean|undefined} */ relayOnly;
  /** @type {((up: boolean) => void)|undefined} */ onSignal;
  /** @type {((link: any) => void)|undefined} */ onChannel;
  /** @type {((message: string) => void)|undefined} */ onError;
  /** @type {((peer: string, wasOpen: boolean) => void)|undefined} */ onClose;

  /** @param {TransportOptions} options */
  constructor(options) {
    Object.assign(this, options);
    this.links = new Map();
    this.closed = false;
    this.ws = null;
    this.timers = new Map();
  }
  async open() {
    const u = new URL(this.signal);
    if (u.hostname === '0.peerjs.com' || u.hostname.endsWith('.peerjs.com'))
      throw Error(
        'Relay mode needs the supplied private server. The public PeerServer is for WebRTC setup only.',
      );
    u.searchParams.set('id', this.id);
    u.searchParams.set('transport', 'relay');
    u.searchParams.set('key', u.searchParams.get('key') || 'peerjs');
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = (this.ws = new WebSocket(u.href)),
        fail = (text) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(Error(text));
          }
        };
      const timer = setTimeout(() => {
        fail('The private relay did not respond. Check its address and server key.');
        ws.close();
      }, 14000);
      ws.onmessage = (event) => {
        if (this.closed || typeof event.data !== 'string' || event.data.length > 100000) return;
        let m;
        try {
          m = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        if (m.type === 'OPEN') {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(this);
          }
          this.onSignal?.(true);
          return;
        }
        if (m.type === 'ID-TAKEN' || m.type === 'ERROR') {
          fail(m.message || 'The relay rejected this connection.');
          this.onError?.(m.message || 'Room code is in use. Create another room.');
          return;
        }
        if (m.type === 'EXPIRE') {
          this.onError?.(
            'Room not found. Check the code and make sure the host is still in the lobby.',
          );
          return;
        }
        if (m.type === 'RELAY_CONNECT') {
          const link = this.makeLink(m.src, false);
          if (link) {
            this.raw({ type: 'RELAY_ACCEPT', dst: m.src });
            this.onChannel?.(link);
          }
          return;
        }
        if (m.type === 'RELAY_ACCEPT') {
          this.makeLink(m.src);
          return;
        }
        if (m.type === 'RELAY_CLOSE') {
          this.drop(m.src, true, false);
          return;
        }
        if (m.type === 'RELAY_DATA') {
          const l = this.links.get(m.src);
          if (l && m.payload && typeof m.payload === 'object') {
            l.lastSeen = performance.now();
            l.bytesIn += event.data.length;
            l.onData?.(m.payload);
          }
        }
      };
      ws.onerror = () =>
        fail('Cannot reach the private relay. Check the server address and network.');
      ws.onclose = () => {
        fail('The relay closed the connection.');
        if (this.closed) return;
        for (const id of [...this.links.keys()]) this.drop(id, true, false);
        this.onSignal?.(false);
      };
    });
  }
  raw(m) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }
  async connect(id) {
    this.raw({ type: 'RELAY_CONNECT', dst: id });
    this.timers.set(
      id,
      setTimeout(() => {
        if (!this.links.has(id))
          this.onError?.('The host did not accept the relay connection. Check the room code.');
      }, 15000),
    );
  }
  makeLink(id, notify = true) {
    if (this.links.has(id)) return this.links.get(id);
    if (this.links.size >= 6) return null;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const self = this;
    const link = {
      id,
      open: true,
      closed: false,
      lastSeen: performance.now(),
      rtt: 0,
      bytesOut: 0,
      bytesIn: 0,
      route: 'WS RELAY',
      dc: {
        readyState: 'open',
        get bufferedAmount() {
          return self.ws?.bufferedAmount || 0;
        },
      },
    };
    this.links.set(id, link);
    if (notify) this.onChannel?.(link);
    return link;
  }
  send(id, packet, essential = false) {
    const l = this.links.get(id);
    if (!l?.open || this.ws?.readyState !== WebSocket.OPEN) return false;
    if (this.ws.bufferedAmount > (essential ? 512000 : 128000)) {
      if (essential) this.drop(id);
      return false;
    }
    try {
      const text = JSON.stringify({ type: 'RELAY_DATA', dst: id, payload: packet });
      if (text.length > 100000) throw Error('Packet too large');
      this.ws.send(text);
      l.bytesOut += text.length;
      return true;
    } catch (_) {
      this.drop(id);
      return false;
    }
  }
  drop(id, notify = true, send = true) {
    const l = this.links.get(id);
    if (!l || l.closed) return;
    l.closed = true;
    l.open = false;
    l.dc.readyState = 'closed';
    this.links.delete(id);
    if (send) this.raw({ type: 'RELAY_CLOSE', dst: id });
    if (notify) this.onClose?.(id, true);
  }
  inspectRoute() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const id of [...this.links.keys()]) this.drop(id, false);
    this.ws?.close();
    this.ws = null;
  }
}
