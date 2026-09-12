import net from 'node:net';
import tls from 'node:tls';

const HOST='api.dataforseo.com',PORT=443,SOCKET='/run/page-autodev/dataforseo-tunnel.sock';
const fail=message=>Object.assign(new Error(message),{code:'DATAFORSEO_TUNNEL_DENIED'});
const CONNECT_LINE=Buffer.from(`CONNECT ${HOST}:${PORT}\n`,'ascii');
const OK_LINE=Buffer.from('OK\n','ascii');

export function createFixedTunnelConnection({connect=net.connect,tlsConnect=tls.connect,timeout_ms=10000}={}){
  return (options,callback)=>{
    if(options.hostname!==HOST||Number(options.port)!==PORT||options.servername!==HOST)throw fail('DESTINATION');
    let settled=false,buffer=Buffer.alloc(0),secure;
    const socket=connect({path:SOCKET});
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback?.(error,value);};
    const timer=setTimeout(()=>{socket.destroy();finish(fail('TIMEOUT'));},timeout_ms);
    socket.once('error',error=>finish(error));
    socket.once('connect',()=>socket.write(CONNECT_LINE));
    const onData=chunk=>{
      buffer=Buffer.concat([buffer,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);
      if(buffer.length>64){socket.destroy();return finish(fail('HANDSHAKE'));}
      const newline=buffer.indexOf(0x0a);if(newline<0)return;
      socket.removeListener('data',onData);
      if(newline!==OK_LINE.length-1||!buffer.subarray(0,newline+1).equals(OK_LINE)||buffer.length!==newline+1){socket.destroy();return finish(fail('REJECTED'));}
      socket.pause();
      secure=tlsConnect({socket,servername:HOST,minVersion:'TLSv1.2'},()=>finish(null,secure));
      secure.once('error',error=>finish(error));
    };
    socket.on('data',onData);
  };
}

export function createFixedTunnelServer({connectUpstream=net.connect}={}){
  return socket=>{
    let buffer=Buffer.alloc(0),upstream;
    const deny=()=>{socket.destroy();upstream?.destroy();};
    const onData=chunk=>{
      buffer=Buffer.concat([buffer,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);
      if(buffer.length>64)return deny();
      const newline=buffer.indexOf(0x0a);if(newline<0)return;
      socket.removeListener('data',onData);
      if(newline!==CONNECT_LINE.length-1||!buffer.subarray(0,newline+1).equals(CONNECT_LINE)||buffer.length!==newline+1)return deny();
      socket.pause();
      upstream=connectUpstream({host:HOST,port:PORT});
      upstream.once('connect',()=>{
        socket.write(OK_LINE);
        socket.pipe(upstream);upstream.pipe(socket);
        socket.resume();
      });
      upstream.once('error',deny);
      socket.once('close',()=>upstream.destroy());
    };
    socket.on('data',onData);
  };
}
