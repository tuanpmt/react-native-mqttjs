/*
* @Author: TuanPM
* @Date:   2016-05-24 14:19:28
* @Last Modified by:   Tuan PM
* @Last Modified time: 2016-05-26 12:10:39
*/

'use strict';

import EventEmitter from 'EventEmitter';
import Store from './mqtt-store';
import { 
  mqtt_msg_type,
  mqtt_msg_connect, 
  mqtt_msg_publish,
  mqtt_msg_puback,
  mqtt_msg_pubrec,
  mqtt_msg_pubrel,
  mqtt_msg_pubcomp,
  mqtt_msg_subscribe,
  mqtt_msg_unsubscribe,
  mqtt_msg_pingreq,
  mqtt_msg_pingresp,
  mqtt_msg_parse,
  mqtt_get_type,
  mqtt_get_dup,
  mqtt_get_qos,
  mqtt_get_retain,
  mqtt_get_id,
  mqtt_get_publish_topic,
  mqtt_get_publish_data,
  mqtt_get_total_length,
} from './mqtt-msg';

const defaultConnectOptions = {
  keepalive: 120,
  protocolId: 'MQTT',
  reconnectPeriod: 1000,
  connectTimeout: 30 * 1000,
  clean: true
};

class MqttClient extends EventEmitter {

  constructor(options) {
    super();
    var self = this;
    this.ws = null;
    this.options = options || {};
    if(!this.options.keepalive)
      this.options.keepalive = 120;
    this.outgoingStore = this.options.outgoingStore || new Store();
    this.incomingStore = this.options.incomingStore || new Store();

    this.queueQoSZero = null == this.options.queueQoSZero ? true : this.options.queueQoSZero;

    // Ping timer, setup in _setupPingTimer
    this.pingTimer = null;
    // Is the client connected?
    this.connected = false;
    // Are we disconnecting?
    this.disconnecting = false;
    // Packet queue
    this.queue = [];
    // connack timer
    this.connackTimer = null;
    // Reconnect timer
    this.reconnectTimer = null;
    // MessageIDs starting with 1
    this.nextId = Math.floor(Math.random() * 65535);

    // Inflight callbacks
    this.outgoing = null;

    //Websocket connected
    this.addListener('connected', () => {
      //send and store pendding connect packet
      self._sendPacket(mqtt_msg_connect(self.options));
    });

    //MQTT connected
    this.addListener('connect', () => {
      self.connected = true;
      //setup ping timer
      // self.subscribe({'/topic': 0}, function(data) {
      //   console.log('subscribe success data', data);
      // })
      console.log('mqtt connected');
      // self.outgoingStore.addListener('insert', function(data) {

      // });
      self.outgoingStore.check();

      self.pingTimer = setInterval(() => {
        //self.sendping();
        self._sendPacket(mqtt_msg_pingreq());
        console.log('ping');
      }, this.options.keepalive*1000/2);
    });

    this.addListener('close', () => {
      self.connected = false;
      clearInterval(this.pingTimer);
    });

    this.addListener('data', (data) => {
      self._handlePacket(data);
    });


    this.outgoingStore.addListener('available', function(data) {
      /* if data availale */
      if(self.connected && self._isOutgoingEmpty()) {

        var msg = self.outgoingStore.getOldest();
        self._sendPacket(msg.data);

        if(mqtt_get_type(msg.data) == mqtt_msg_type.MQTT_MSG_TYPE_PUBLISH 
          && mqtt_get_qos(msg.data) == 0) {
          
          console.log('publish with qos = 0, msgId = ' + msg.msgId);
          if(msg.cb)
            msg.cb();
          self.outgoingStore.del(msg);
          self._clearOutgoing();
        }
      }
    });
  }


  _clearOutgoing() {
    this.outgoing = null;
  }

  _isOutgoingEmpty() {
    return this.outgoing == null;
  }

  _handlePacket(data) {
    if(!data) return;

    var dataBuffer = new Uint8Array(data);
    

    var self = this;

    var msg_type = mqtt_get_type(dataBuffer);
    var msg_qos  = mqtt_get_qos(dataBuffer);
    var msg_id   = mqtt_get_id(dataBuffer);
    var total_len= mqtt_get_total_length(dataBuffer);

    switch(msg_type) {
      case mqtt_msg_type.MQTT_MSG_TYPE_CONNACK:
        if(dataBuffer[3] != 0 || mqtt_get_type(self.outgoing) != mqtt_msg_type.MQTT_MSG_TYPE_CONNECT)
          return self.emit('error', {type: 'connect', msgId: dataBuffer[3]});

        self._clearOutgoing();
        self.emit('connect');
        break;
        
      case mqtt_msg_type.MQTT_MSG_TYPE_PINGRESP:
        console.log('MQTT_MSG_TYPE_PINGRESP');
        self._clearOutgoing();
        break;

      case mqtt_msg_type.MQTT_MSG_TYPE_SUBACK:
        console.log('MQTT_MSG_TYPE_SUBACK');
        var msg = self.outgoingStore.get({msgId: msg_id});
        if(msg) {
          self.outgoingStore.del({msgId: msg_id});
          self._clearOutgoing();
          if(msg.cb)
            msg.cb();
        }
        break;

      case mqtt_msg_type.MQTT_MSG_TYPE_PUBLISH:
        console.log('MQTT_MSG_TYPE_PUBLISH');
        if(msg_qos == 1) {
          self._sendPacket(mqtt_msg_puback(msg_id));
          console.log('qos1');
        } else if(msg_qos == 2) {
          self._sendPacket(mqtt_msg_pubrec(msg_id));
          console.log('qos2');

        }

        self._deliverPublish(dataBuffer);
        break;
      case mqtt_msg_type.MQTT_MSG_TYPE_PUBACK:
        console.log('MQTT_MSG_TYPE_PUBACK');

        var msg = self.outgoingStore.get({msgId: msg_id});
        if(msg.msgId == msg_id && mqtt_get_type(msg.data) == mqtt_msg_type.MQTT_MSG_TYPE_PUBLISH) {
          if(msg.cb)
            msg.cb();
          self.outgoingStore.del({msgId: msg_id});
          self._clearOutgoing();

        }
        break;
      case mqtt_msg_type.MQTT_MSG_TYPE_PUBREC:
        console.log('MQTT_MSG_TYPE_PUBREC');
        if(msg_id == mqtt_get_id(self.outgoing)) {
          self._sendPacket(mqtt_msg_pubrel(msg_id));
        }
        break;
      case mqtt_msg_type.MQTT_MSG_TYPE_PUBREL:
        console.log('MQTT_MSG_TYPE_PUBREL');
        if(msg_id == mqtt_get_id(self.outgoing)) {
          self._sendPacket(mqtt_msg_pubcomp(msg_id));
        }
        break;
      case mqtt_msg_type.MQTT_MSG_TYPE_PUBCOMP:
        console.log('MQTT_MSG_TYPE_PUBCOMP');
        var msg = self.outgoingStore.get({msgId: msg_id});
        if(msg.msgId == msg_id && mqtt_get_type(msg.data) == mqtt_msg_type.MQTT_MSG_TYPE_PUBLISH) {
          if(msg.cb)
            msg.cb();
          self.outgoingStore.del({msgId: msg_id});
          self._clearOutgoing();

        }

    }
    
    self.outgoingStore.check();
    //switch packet data
    //if pendding packet == connect && msgId == pendding.msgId then emit event 'connect'
  }

  _deliverPublish(buffer) {
    let topic = mqtt_get_publish_topic(buffer);
    let data = mqtt_get_publish_data(buffer);
    //console.log(topic + ':' + data);
    this.emit('message', topic, data);
  }

  _nextId () {
    var id = this.nextId++;
    // Ensure 16 bit unsigned int:
    if (65535 === id) {
      this.nextId = 1;
    }
    return id;
  }

  _sendPacket(packet) {
    if(this.ws) {
      this.outgoing = packet;
      this.ws.send(new Uint8Array(packet));
    }
  }

  connect(uri) {
    var self = this;

    self.ws = new WebSocket(uri);

    self.ws.onopen = () => {
      // connection opened
      console.log('connected');
      self.emit('connected');
      
    };

    self.ws.onmessage = (e) => {
      // a message was received
      self.emit('data', e.data);
    };

    self.ws.onerror = (e) => {
      // an error occurred
      self.emit('error', e.message);
      
    };

    self.ws.onclose = (e) => {
      // connection closed
      self.emit('close', e);
      //console.log(e.code, e.reason);
      
    };
  }

  publish(topic, message, options, cb) {
    var msgId = this._nextId();
    this.outgoingStore.put({msgId: msgId, cb: cb, data: mqtt_msg_publish(msgId, topic, message, options)});
  }

  subscribe(data, cb) {
    var msgId = this._nextId();
    this.outgoingStore.put({msgId: msgId, cb: cb, data: mqtt_msg_subscribe(msgId, data)});
  }

  unsubscribe() {

  }
  
}

export {
  MqttClient
}
