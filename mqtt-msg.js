/*
* @Author: TuanPM
* @Date:   2016-05-24 14:56:01
* @Last Modified by:   TuanPM
* @Last Modified time: 2016-05-26 11:26:49
*/

'use strict';

const mqtt_msg_type = 
{
  MQTT_MSG_TYPE_CONNECT : 1,
  MQTT_MSG_TYPE_CONNACK : 2,
  MQTT_MSG_TYPE_PUBLISH : 3,
  MQTT_MSG_TYPE_PUBACK  : 4,
  MQTT_MSG_TYPE_PUBREC  : 5,
  MQTT_MSG_TYPE_PUBREL  : 6,
  MQTT_MSG_TYPE_PUBCOMP : 7,
  MQTT_MSG_TYPE_SUBSCRIBE : 8,
  MQTT_MSG_TYPE_SUBACK    : 9,
  MQTT_MSG_TYPE_UNSUBSCRIBE: 10,
  MQTT_MSG_TYPE_UNSUBACK: 11,
  MQTT_MSG_TYPE_PINGREQ: 12,
  MQTT_MSG_TYPE_PINGRESP: 13,
  MQTT_MSG_TYPE_DISCONNECT:14
};
const mqtt_connect_flag =
{
  MQTT_CONNECT_FLAG_USERNAME      : 1 << 7,
  MQTT_CONNECT_FLAG_PASSWORD      : 1 << 6,
  MQTT_CONNECT_FLAG_WILL_RETAIN   : 1 << 5,
  MQTT_CONNECT_FLAG_WILL          : 1 << 2,
  MQTT_CONNECT_FLAG_CLEAN_SESSION : 1 << 1
};

Array.prototype.push_len = function(data) {
  this.push((data & 0xFFFF) >> 8);
  this.push(data & 0xFF);
}

Array.prototype.push_str = function(str) {
  let self = this;
  this.push((str.length & 0xFFFF) >> 8);
  this.push(str.length & 0xFF);
  str.split('').map(c => self.push(c.charCodeAt(0)));
}

Array.prototype.push_array = function(arr) {
  let self = this;
  this.push((str.length & 0xFFFF) >> 8);
  this.push(str.length & 0xFF);
  arr.map(c => self.push(c));
}

Array.prototype.to_str = function() {
  let arr = this;
  let str = '';
  arr.map((c) => {
    str += String.fromCharCode(c);
  });
  return str;
}

var encodeLen = (len) => {
  var ret = [];

  do {
    let encodeByte = len%128;
    len = Math.trunc(len/128);
    if(len > 0) {
      encodeByte |= 128;
    }
    ret.push(encodeByte);
  } while(len > 0);
  return ret;
}

var mqtt_fixed_header = function(len, type, dup, qos, retain) {
  let fixed_header = [];
  fixed_header.push( ((type & 0x0f) << 4) | ((dup & 1) << 3) | ((qos & 3) << 1) | (retain & 1) );
  return fixed_header.concat(encodeLen(len));
}

var mqtt_msg_connect = function(info) {


  let connection_info = {
    protocolId: 'MQTT', //MQIsdp
    clientId: 'mqttjs_' + Math.random().toString(16).substr(2, 8),
    clean: true,
    connectTimeout: 30000,
    keepalive: 120,
    username: null,
    password: null, 
    will: null,
  };

  let payload = [];
  let variable_header = [];           //protocolLen

  for(let info_key in connection_info) {
    //console.log(info_key);
    info[info_key] && (connection_info[info_key] = info[info_key]);
  }

  if(connection_info.protocolId != 'MQTT' && connection_info.protocolId != 'MQIsdp') 
    return null;

  
  variable_header.push_str(connection_info.protocolId);  
  variable_header.push(connection_info.protocolId === 'MQTT'? 4: 3);                //level

  let flags = 0;
  if(connection_info.clean)
    flags |= mqtt_connect_flag.MQTT_CONNECT_FLAG_CLEAN_SESSION;

  if(connection_info.clientId != null) {
    payload.push_str(connection_info.clientId);
  }

  if(connection_info.will && connection_info.will.willTopic && connection_info.will.willMsg) {
    
    payload.push_str(connection_info.will.willTopic);
    payload.push_str(connection_info.will.willMsg);

    flags |= mqtt_connect_flag.MQTT_CONNECT_FLAG_WILL;
    if(connection_info.will.willRetain)
      flags |= mqtt_connect_flag.MQTT_CONNECT_FLAG_WILL_RETAIN;

    flags |= (connection_info.will.willQos & 3) << 4;
  }

  if(connection_info.username != null) {
    payload.push_str(connection_info.username)
    flags |= mqtt_connect_flag.MQTT_CONNECT_FLAG_USERNAME;
  }

  if(connection_info.password != null) {
    payload.push_str(connection_info.password)

    flags |= mqtt_connect_flag.MQTT_CONNECT_FLAG_PASSWORD;
  }

  variable_header.push(flags); //flag

  variable_header.push_len(connection_info.keepalive);

  let totalLen = variable_header.length + payload.length;

  let fixed_header = mqtt_fixed_header(totalLen, mqtt_msg_type.MQTT_MSG_TYPE_CONNECT, 0, 0, 0);

  return fixed_header.concat(variable_header, payload);

}

var mqtt_get_publish_topic = function(buffer)
{
  let topiclen;
  let totlen = 0;
  let i;
  for(i = 1; i < buffer.length; ++i)
  {
    totlen += (buffer[i] & 0x7f) << (7 * (i  -1));
    if((buffer[i] & 0x80) == 0)
    {
      ++i;
      break;
    }
  }
  totlen += i;

  if(i + 2 >= buffer.length)
    return null;

  topiclen =  buffer[i++] << 8;
  topiclen |= buffer[i++];

  if(i + topiclen > buffer.length)
    return null;

  // *length = topiclen;
  let topic = [];
  for(let j=0; j<topiclen; j++) {
    topic.push(buffer[i + j]);
  }
  return topic.to_str();
}

var mqtt_get_publish_data = function(buffer)
{
  let i, length;
  let totlen = 0;
  let topiclen;
  let blength = buffer.length;


  for(i = 1; i < blength; ++i)
  {
    totlen += (buffer[i] & 0x7f) << (7 * (i - 1));
    if((buffer[i] & 0x80) == 0)
    {
      ++i;
      break;
    }
  }
  totlen += i;
  
  if(i + 2 >= blength)
    return null;

  topiclen  = buffer[i++] << 8;
  topiclen |= buffer[i++];

  if(i + topiclen >= blength)
    return null;

  i += topiclen;

  if(mqtt_get_qos(buffer) > 0)
  {
    if(i + 2 >= blength)
      return null;
    i += 2;
  }

  if(totlen < i)
    return null;

  if(totlen <= blength)
    length = totlen - i;
  else
    length = blength - i;

  let data = [];
  for(let j=0; j<length; j++) {
    data.push(buffer[i + j]);
  }

  return data.to_str();//new Uint8Array(data);
}

var mqtt_msg_publish = function(msgId, topic, message, options) {
  if(!topic)
    return null;

  if(!options) {
    options = {qos: 0, retain: 0};
  }
  if(!options.qos)
    options.qos = 0;
  if(!options.retain)
    options.retain = 0;

  if(options.qos == 0) {
    msgId = 0;
  }

  let payload = [];
  let variable_header = [];
  let topic_len = topic.length;

  variable_header.push_str(topic);
  variable_header.push_len(msgId);

  if(message) {
    if(typeof message == 'string')
      payload.push_str(message);
    else if(Array.isArray(message))
      payload.push_array(message);
  }
  let totalLen = variable_header.length + payload.length;
  let fixed_header = mqtt_fixed_header(totalLen, mqtt_msg_type.MQTT_MSG_TYPE_PUBLISH, 0, options.qos, options.retain);
  return fixed_header.concat(variable_header, payload);
}

var mqtt_msg_puback = function(msgId) {
  let variable_header = [];
  variable_header.push((msgId& 0xFFFF) >> 8);
  variable_header.push(msgId& 0xFF);

  let totalLen = variable_header.length;
  let fixed_header = mqtt_fixed_header(totalLen, mqtt_msg_type.MQTT_MSG_TYPE_PUBACK, 0, 0, 0);
  return fixed_header.concat(variable_header);
}

var mqtt_msg_pubrec = function(msgId) {
  let variable_header = [];
  variable_header.push((msgId& 0xFFFF) >> 8);
  variable_header.push(msgId& 0xFF);

  let totalLen = variable_header.length;
  let fixed_header = mqtt_fixed_header(totalLen, mqtt_msg_type.MQTT_MSG_TYPE_PUBREC, 0, 0, 0);
  return fixed_header.concat(variable_header);
}

var mqtt_msg_pubrel = function(msgId) {
  let variable_header = [];
  variable_header.push((msgId& 0xFFFF) >> 8);
  variable_header.push(msgId& 0xFF);

  let totalLen = variable_header.length;
  let fixed_header = mqtt_fixed_header(totalLen, mqtt_msg_type.MQTT_MSG_TYPE_PUBREL, 0, 0, 0);
  return fixed_header.concat(variable_header);
}

var mqtt_msg_pubcomp = function(msgId) {
  let variable_header = [];
  variable_header.push((msgId& 0xFFFF) >> 8);
  variable_header.push(msgId& 0xFF);

  let totalLen = variable_header.length;
  let fixed_header = mqtt_fixed_header(totalLen, mqtt_msg_type.MQTT_MSG_TYPE_PUBCOMP, 0, 0, 0);
  return fixed_header.concat(variable_header);
}

var mqtt_msg_subscribe = function(msgId, info) {
  if(!info)
    return null;
  let variable_header = [];
  let payload = [];

  variable_header.push_len(msgId);

  if(typeof info === 'string') {
    payload.push_str(info);
    payload.push(0);
  } else {
    var topic = Object.keys(info);
    topic.map(t => {
      payload.push_str(t);
      payload.push(info[t]);
    });
  }
  
  
  let totalLen = variable_header.length + payload.length;
  let fixed_header = mqtt_fixed_header(totalLen, mqtt_msg_type.MQTT_MSG_TYPE_SUBSCRIBE, 0, 1, 0);
  return fixed_header.concat(variable_header, payload);
}

function mqtt_get_id(buffer)
{
  var length = buffer.length;
  if(length < 1)
    return 0;

  switch(mqtt_get_type(buffer))
  {
    case mqtt_msg_type.MQTT_MSG_TYPE_PUBLISH:
    {
      let i;
      let topiclen;

      for(i = 1; i < length; ++i)
      {
        if((buffer[i] & 0x80) == 0)
        {
          ++i;
          break;
        }
      }
  
      if(i + 2 >= length)
        return 0;
      topiclen  = buffer[i++] << 8;
      topiclen |= buffer[i++];

      if(i + topiclen >= length)
        return 0;
      i += topiclen;

      if(mqtt_get_qos(buffer) > 0)
      {
        if(i + 2 >= length)
          return 0;
      }
      else
        return 0;

      return (buffer[i] << 8) | buffer[i + 1];
    }
    case mqtt_msg_type.MQTT_MSG_TYPE_PUBACK:
    case mqtt_msg_type.MQTT_MSG_TYPE_PUBREC:
    case mqtt_msg_type.MQTT_MSG_TYPE_PUBREL:
    case mqtt_msg_type.MQTT_MSG_TYPE_PUBCOMP:
    case mqtt_msg_type.MQTT_MSG_TYPE_SUBACK:
    case mqtt_msg_type.MQTT_MSG_TYPE_UNSUBACK:
    case mqtt_msg_type.MQTT_MSG_TYPE_SUBSCRIBE:
    {
      // This requires the remaining length to be encoded in 1 byte,
      // which it should be.
      if(length >= 4 && (buffer[1] & 0x80) == 0)
        return (buffer[2] << 8) | buffer[3];
      else
        return 0;
    }
    default:
      return 0;
  }
}
var mqtt_get_total_length = function(buffer)
{
  let i;
  let totlen = 0;
  let length = buffer.length;

  for(i = 1; i < length; ++i)
  {
    totlen += (buffer[i] & 0x7f) << (7 * (i - 1));
    if((buffer[i] & 0x80) == 0)
    {
      ++i;
      break;
    }
  }
  totlen += i;

  return totlen;
}
var mqtt_msg_unsubscribe = function() {

}
var mqtt_msg_pingreq = function() {
  return mqtt_fixed_header(0, mqtt_msg_type.MQTT_MSG_TYPE_PINGREQ, 0, 0, 0);
}

var mqtt_msg_pingresp = function() {

}

var mqtt_msg_disconnect = function() {

}

function mqtt_get_type(buffer)   { return (buffer[0] & 0xf0) >> 4; }
function mqtt_get_dup(buffer)    { return (buffer[0] & 0x08) >> 3; }
function mqtt_get_qos(buffer)    { return (buffer[0] & 0x06) >> 1; }
function mqtt_get_retain(buffer) { return (buffer[0] & 0x01); }

var mqtt_msg_parse = function(data) {
  let msgType = null;
  for(let msgKey in mqtt_msg_type) {
    if(mqtt_msg_type[msgKey] == mqtt_get_type(data)) {
      msgType = mqtt_msg_type[msgKey];
    }
  }
  console.log(msgType);
}
export { 
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
  mqtt_get_total_length,
  mqtt_get_publish_topic,
  mqtt_get_publish_data,
}
