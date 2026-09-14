import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const failure=(message,code='BILLING_GATEWAY_SERVER_ERROR')=>Object.assign(new Error(message),{code});
const probe=socketPath=>new Promise(resolve=>{
  const socket=net.createConnection(socketPath);
  const finish=value=>{socket.destroy();resolve(value);};
  socket.once('connect',()=>finish('active'));
  socket.once('error',error=>finish(error.code==='ECONNREFUSED'?'stale':'unknown'));
  socket.setTimeout(250,()=>finish('unknown'));
});

export function createBillingGatewayUnixServer({policy,handler,max_body_bytes=262144,request_timeout_ms=180000,createServer=http.createServer}={}){
  const socketPath=policy?.listener?.path;
  const runtimeRoot=typeof process.getuid==='function'?`/run/user/${process.getuid()}`:null;
  if(typeof handler!=='function'||typeof createServer!=='function'||!runtimeRoot||path.dirname(socketPath??'')!==runtimeRoot||!/^page-autodev-billing-gateway(?:-[A-Za-z0-9._-]+)?\.sock$/.test(path.basename(socketPath??''))||!Number.isSafeInteger(max_body_bytes)||max_body_bytes<1024||max_body_bytes>1048576||!Number.isSafeInteger(request_timeout_ms)||request_timeout_ms<1000||request_timeout_ms>600000)throw failure('BILLING_GATEWAY_SERVER_CONFIG_INVALID','BILLING_GATEWAY_CONFIG_INVALID');
  let server,socketActivated=false;
  const requestListener=(request,response)=>{
    const chunks=[];let size=0,settled=false;
    const send=(status,value)=>{if(settled)return;settled=true;response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
    request.on('data',chunk=>{size+=chunk.length;if(size>max_body_bytes){send(413,{ok:false,code:'BILLING_GATEWAY_BODY_DENIED'});request.destroy();return;}chunks.push(chunk);});
    request.on('error',()=>send(400,{ok:false,code:'BILLING_GATEWAY_REQUEST_DENIED'}));
    request.on('end',async()=>{if(settled)return;try{const result=await handler({method:request.method,path:new URL(request.url,'http://unix').pathname,content_type:String(request.headers['content-type']??'').split(';')[0].trim().toLowerCase(),body:Buffer.concat(chunks),signal:AbortSignal.timeout(request_timeout_ms)});send(200,{ok:true,result});}catch(error){const code=typeof error?.code==='string'?error.code:error?.name==='TimeoutError'?'PROVIDER_TIMEOUT':'BILLING_GATEWAY_REQUEST_DENIED';send(403,{ok:false,code});}});
  };
  return Object.freeze({
    async start(listenOptions=null){
      if(server)throw failure('BILLING_GATEWAY_ALREADY_STARTED');
      if(listenOptions!==null){
        if(!Number.isInteger(listenOptions?.fd)||listenOptions.fd<0)throw failure('BILLING_GATEWAY_SOCKET_ACTIVATION_INVALID','BILLING_GATEWAY_CONFIG_INVALID');
        server=createServer(requestListener);
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({fd:listenOptions.fd},()=>{server.off('error',reject);resolve();});});
        socketActivated=true;
        return {socket_activation:true,fd:listenOptions.fd};
      }
      const rootStat=fs.lstatSync(runtimeRoot);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootStat.uid!==process.getuid()||(rootStat.mode&0o022)!==0)throw failure('BILLING_GATEWAY_RUNTIME_ROOT_UNSAFE');
      if(fs.existsSync(socketPath)){
        const stat=fs.lstatSync(socketPath);if(!stat.isSocket())throw failure('BILLING_GATEWAY_SOCKET_PATH_UNSAFE');
        const state=await probe(socketPath);if(state!=='stale')throw failure('BILLING_GATEWAY_SOCKET_IN_USE');fs.unlinkSync(socketPath);
      }
      server=createServer(requestListener);
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});
      fs.chmodSync(socketPath,0o600);return {socket_path:socketPath};
    },
    async stop(){if(!server)return;const current=server,activated=socketActivated;server=undefined;socketActivated=false;await new Promise((resolve,reject)=>current.close(error=>error?reject(error):resolve()));if(activated)return;try{const stat=fs.lstatSync(socketPath);if(stat.isSocket())fs.unlinkSync(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}},
    socketPath
  });
}
