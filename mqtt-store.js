/*
* @Author: TuanPM
* @Date:   2016-05-24 20:34:09
* @Last Modified by:   TuanPM
* @Last Modified time: 2016-05-25 15:00:22
*/

'use strict';

import EventEmitter from 'EventEmitter';

class Store extends EventEmitter {
  constructor() {
    super();
    this._inflights = {};
    this._len = 0;
    this._msgIdx = [];
  }

  put(packet, cb) {
    this._inflights[packet.msgId] = packet;
    this._len ++;
    this._msgIdx.push(packet.msgId);

    cb && cb();
    this.emit('available', packet);
    return this;
  }


  close(cb) {
    this._inflights = null;
    if (cb) {
      cb();
    }
    this.emit('closed');
  }

  get(packet, cb) {
    packet = this._inflights[packet.msgId];
     if (packet) {
       cb && cb(null, packet);
     } else if (cb) {
       cb(new Error('missing packet'));
     }
     return packet;
  }

  getOldest() {
    var packet = null;
    if(this.available()) {
      var packetIdx = this._msgIdx[0];
      packet = this._inflights[packetIdx];
    }
    return packet;
  }

  del(packet, cb) {
    packet = this._inflights[packet.msgId];
    if (packet) {
      delete this._inflights[packet.msgId];
      this._len --;
      var idx = this._msgIdx.indexOf(packet.msgId);
      if(idx >= 0) {
        this._msgIdx.splice(idx, 1);
      }
      cb && cb(null, packet);
    } else if (cb) {
      cb(new Error('missing packet'));
    }
    return this;
  }

  available() {
    return this._len > 0;
  }

  check() {
    if(this.available())
      this.emit('available');
  }
}


export default Store;
