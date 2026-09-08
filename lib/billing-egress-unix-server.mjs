import http from 'node:http';

const failure=(message,code='BILLING_EGRESS_SERVER_ERROR')=>Object.assign(new Error(message),{code});
const wireKeys=new Set(['gateway_assertion','request_id','method','path','model_snapshot','body_base64','body_sha256']);

export function createBillingEgressUnixServer({handler,max_wire_bytes=524288}={}){
  if(typeof handler!=='function'||!Number.isSafeInteger(max_wire_bytes)||max_wire_bytes<1024||max_wire_bytes>1048576)throw failure('BILLING_EGRESS_SERVER_CONFIG_INVALID','BILLING_EGRESS_CONFIG_INVALID');
  let server;
  const listener=(request,response)=>{
    const chunks=[];let size=0,settled=false;
    const send=(status,value)=>{if(settled)return;settled=true;response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
    request.on('data',chunk=>{size+=chunk.length;if(size>max_wire_bytes){send(413,{ok:false,code:'BILLING_EGRESS_WIRE_TOO_LARGE'});request.destroy();return;}chunks.push(chunk);});
    request.on('error',()=>send(400,{ok:false,code:'BILLING_EGRESS_WIRE_INVALID'}));
    request.on('end',async()=>{if(settled)return;try{
      if(request.method!=='POST'||request.url!=='/dispatch'||String(request.headers['content-type']??'').split(';')[0].trim().toLowerCase()!=='application/json')throw failure('BILLING_EGRESS_ROUTE_DENIED','BILLING_EGRESS_DENIED');
      const wire=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!wire||typeof wire!=='object'||Array.isArray(wire)||Object.keys(wire).some(key=>!wireKeys.has(key))||typeof wire.body_base64!=='string')throw failure('BILLING_EGRESS_WIRE_INVALID','BILLING_EGRESS_DENIED');
      const body=Buffer.from(wire.body_base64,'base64');if(body.toString('base64')!==wire.body_base64)throw failure('BILLING_EGRESS_BODY_ENCODING_INVALID','BILLING_EGRESS_DENIED');
      const result=await handler({gateway_assertion:wire.gateway_assertion,request_id:wire.request_id,method:wire.method,path:wire.path,model_snapshot:wire.model_snapshot,body,body_sha256:wire.body_sha256});send(200,{ok:true,result});
    }catch(error){send(403,{ok:false,code:error?.code??'BILLING_EGRESS_DENIED'});}});
  };
  return Object.freeze({
    async start(listenOptions={fd:3}){if(server)throw failure('BILLING_EGRESS_ALREADY_STARTED');server=http.createServer(listener);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(listenOptions,()=>{server.off('error',reject);resolve();});});return {listening:true};},
    async stop(){if(!server)return;const current=server;server=undefined;await new Promise((resolve,reject)=>current.close(error=>error?reject(error):resolve()));}
  });
}
