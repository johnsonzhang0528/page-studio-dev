import net from 'node:net';
import tls from 'node:tls';

const HOST='api.openai.com',PORT=443,fail=(message)=>Object.assign(new Error(message),{code:'FIXED_EGRESS_TUNNEL_DENIED'});

export function createFixedTunnelConnection({socket_path='/run/page-autodev/openai-tunnel.sock',connect=net.connect,tlsConnect=tls.connect,timeout_ms=10000}={}){
  if(socket_path!=='/run/page-autodev/openai-tunnel.sock'||typeof connect!=='function'||typeof tlsConnect!=='function')throw fail('FIXED_TUNNEL_CLIENT_CONFIG_INVALID');
  return function createConnection(options,callback){
    const hostname=options?.hostname??options?.host,servername=options?.servername??hostname;
    if(hostname!==HOST||Number(options?.port)!==PORT||servername!==HOST||(options?.hostname&&options?.host&&options.hostname!==options.host))throw fail('FIXED_TUNNEL_DESTINATION_DENIED');
    let settled=false,secure=null;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback?.(error,value);};
    const socket=connect({path:socket_path}),timer=setTimeout(()=>{const error=fail('FIXED_TUNNEL_CONNECT_TIMEOUT');socket.destroy(error);finish(error);},timeout_ms);let buffer=Buffer.alloc(0);
    socket.once('error',error=>finish(error));socket.once('connect',()=>socket.write(`CONNECT ${HOST}:${PORT}\n`));socket.on('data',chunk=>{buffer=Buffer.concat([buffer,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);const at=buffer.indexOf(0x0a);if(at<0){if(buffer.length>64){const error=fail('FIXED_TUNNEL_HANDSHAKE_INVALID');socket.destroy(error);finish(error);}return;}socket.removeAllListeners('data');if(buffer.subarray(0,at).toString('ascii')!=='OK'){const error=fail('FIXED_TUNNEL_REJECTED');socket.destroy(error);finish(error);return;}const remainder=buffer.subarray(at+1);if(remainder.length)socket.unshift(remainder);secure=tlsConnect({socket,servername:HOST,minVersion:'TLSv1.2'},()=>finish(null,secure));secure.once('error',error=>finish(error));});
    return undefined;
  };
}

export function createFixedTunnelServer({connectUpstream=net.connect,max_handshake_bytes=64}={}){
  return socket=>{let buffer=Buffer.alloc(0);const deny=()=>socket.destroy();socket.on('data',chunk=>{buffer=Buffer.concat([buffer,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);const at=buffer.indexOf(0x0a);if(at<0){if(buffer.length>max_handshake_bytes)deny();return;}socket.removeAllListeners('data');if(buffer.subarray(0,at).toString('ascii')!==`CONNECT ${HOST}:${PORT}`){deny();return;}const remainder=buffer.subarray(at+1),upstream=connectUpstream({host:HOST,port:PORT});upstream.once('connect',()=>{socket.write(Buffer.from('OK\n'));if(remainder.length)upstream.write(remainder);socket.pipe(upstream);upstream.pipe(socket);});upstream.once('error',deny);socket.once('error',()=>upstream.destroy());socket.once('close',()=>upstream.destroy());});};
}
