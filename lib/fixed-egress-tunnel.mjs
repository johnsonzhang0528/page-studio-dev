import net from 'node:net';
import tls from 'node:tls';

const HOST='api.openai.com',PORT=443,fail=(message)=>Object.assign(new Error(message),{code:'FIXED_EGRESS_TUNNEL_DENIED'});

export function createFixedTunnelConnection({socket_path='/run/page-autodev/openai-tunnel.sock',connect=net.connect,tlsConnect=tls.connect,timeout_ms=10000}={}){
  if(socket_path!=='/run/page-autodev/openai-tunnel.sock'||typeof connect!=='function'||typeof tlsConnect!=='function')throw fail('FIXED_TUNNEL_CLIENT_CONFIG_INVALID');
  return function createConnection(options,callback){
    if(options.hostname!==HOST||Number(options.port)!==PORT||options.servername!==HOST)throw fail('FIXED_TUNNEL_DESTINATION_DENIED');
    let settled=false,secure=null;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback?.(error,value);};
    const socket=connect({path:socket_path}),timer=setTimeout(()=>{const error=fail('FIXED_TUNNEL_CONNECT_TIMEOUT');socket.destroy(error);finish(error);},timeout_ms);let buffer='';
    socket.once('error',error=>finish(error));socket.setEncoding('utf8');socket.once('connect',()=>socket.write(`CONNECT ${HOST}:${PORT}\n`));socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>64){const error=fail('FIXED_TUNNEL_HANDSHAKE_INVALID');socket.destroy(error);finish(error);return;}const at=buffer.indexOf('\n');if(at<0)return;socket.removeAllListeners('data');socket.setEncoding(null);if(buffer.slice(0,at)!=='OK'||buffer.slice(at+1)!==''){const error=fail('FIXED_TUNNEL_REJECTED');socket.destroy(error);finish(error);return;}secure=tlsConnect({socket,servername:HOST,minVersion:'TLSv1.2'},()=>finish(null,secure));secure.once('error',error=>finish(error));});
    return undefined;
  };
}

export function createFixedTunnelServer({connectUpstream=net.connect,max_handshake_bytes=64}={}){
  return socket=>{let buffer='';socket.setEncoding('utf8');const deny=()=>socket.destroy();socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>max_handshake_bytes){deny();return;}const at=buffer.indexOf('\n');if(at<0)return;socket.removeAllListeners('data');if(buffer.slice(0,at)!==`CONNECT ${HOST}:${PORT}`||buffer.slice(at+1)!==''){deny();return;}const upstream=connectUpstream({host:HOST,port:PORT});upstream.once('connect',()=>{socket.write('OK\n');socket.setEncoding(null);socket.pipe(upstream);upstream.pipe(socket);});upstream.once('error',deny);socket.once('error',()=>upstream.destroy());socket.once('close',()=>upstream.destroy());});};
}
