import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createToolBrokerPolicy } from './tool-broker-policy.mjs';
import { redactSecrets, safeSubprocessEnv } from './subprocess-policy.mjs';

const MAX_FRAME_BYTES=1024*1024,MAX_FILE_BYTES=512*1024,MAX_OUTPUT_BYTES=256*1024;
const schemas=Object.freeze([
  {name:'read_file',description:'Read one UTF-8 text file inside the declared project scope. Optional offset and limit select a bounded line range.',inputSchema:{type:'object',properties:{path:{type:'string'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}},required:['path'],additionalProperties:false}},
  {name:'list_directory',description:'List one directory inside the declared project scope.',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
  {name:'sha256_file',description:'Calculate the SHA-256 digest of one readable in-scope file.',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
  {name:'write_file',description:'Atomically write one UTF-8 text file when isolated-write mode permits it.',inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}},
  {name:'move_file',description:'Safely move one existing project file to a new in-scope path without overwriting.',inputSchema:{type:'object',properties:{source:{type:'string'},destination:{type:'string'}},required:['source','destination'],additionalProperties:false}},
  {name:'run_argv',description:'Run an exact predeclared argv command without a shell or network capability.',inputSchema:{type:'object',properties:{argv:{type:'array',items:{type:'string'},minItems:1}},required:['argv'],additionalProperties:false}}
]);
const textResult=(text,isError=false)=>({content:[{type:'text',text:String(text)}],...(isError?{isError:true}:{})});

export function createToolBrokerRuntime(config){
  if(!config||typeof config!=='object')throw new Error('TOOL_BROKER_CONFIG_REQUIRED');
  const policy=createToolBrokerPolicy(config),timeout=Math.min(120000,Math.max(1000,Number(config.timeout_ms??30000)));
  const call=(name,args={})=>{
    if(name==='read_file'){
      const target=policy.authorizeRead(args.path),stat=fs.statSync(target);if(!stat.isFile()||stat.size>MAX_FILE_BYTES)throw new Error('TOOL_READ_SIZE_OR_TYPE_DENIED');
      const data=fs.readFileSync(target);if(data.includes(0))throw new Error('TOOL_BINARY_READ_DENIED');
      const content=data.toString('utf8');
      if(args.offset===undefined&&args.limit===undefined&&data.length<=16*1024)return textResult(content);
      const lines=content.split('\n');
      const offset=args.offset??0,limit=args.limit??80;
      if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw new Error('TOOL_READ_RANGE_INVALID');
      const selected=lines.slice(offset,offset+limit).join('\n');
      if(Buffer.byteLength(selected)>32*1024)throw new Error('TOOL_READ_RANGE_TOO_LARGE');
      return textResult(JSON.stringify({path:args.path,offset,limit,total_lines:lines.length,content:selected}));
    }
    if(name==='list_directory'){
      const target=policy.authorizeRead(args.path),stat=fs.statSync(target);if(!stat.isDirectory())throw new Error('TOOL_LIST_NOT_DIRECTORY');
      return textResult(fs.readdirSync(target,{withFileTypes:true}).slice(0,1000).map(entry=>`${entry.isDirectory()?'dir':'file'}\t${entry.name}`).join('\n'));
    }
    if(name==='sha256_file'){
      const target=policy.authorizeRead(args.path),stat=fs.statSync(target);if(!stat.isFile()||stat.size>MAX_FILE_BYTES)throw new Error('TOOL_HASH_SIZE_OR_TYPE_DENIED');
      return textResult(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'));
    }
    if(name==='write_file'){
      if(typeof args.content!=='string'||Buffer.byteLength(args.content)>MAX_FILE_BYTES)throw new Error('TOOL_WRITE_SIZE_DENIED');
      const target=policy.authorizeWrite(args.path);fs.mkdirSync(path.dirname(target),{recursive:true});const temporary=`${target}.broker-${process.pid}-${Date.now()}.tmp`;
      try{fs.writeFileSync(temporary,args.content,{encoding:'utf8',mode:0o600,flag:'wx'});fs.renameSync(temporary,target);}finally{fs.rmSync(temporary,{force:true});}return textResult('WRITE_OK');
    }
    if(name==='move_file'){
      const targets=policy.authorizeMove(args.source,args.destination),stat=fs.statSync(targets.source);if(!stat.isFile())throw new Error('TOOL_MOVE_TYPE_DENIED');
      fs.mkdirSync(path.dirname(targets.destination),{recursive:true});fs.renameSync(targets.source,targets.destination);return textResult('MOVE_OK');
    }
    if(name==='run_argv'){
      const argv=policy.authorizeShell(args.argv),result=spawnSync(argv[0],argv.slice(1),{cwd:policy.root,env:safeSubprocessEnv(),shell:false,encoding:'utf8',timeout,maxBuffer:MAX_OUTPUT_BYTES});
      const output=redactSecrets(`${result.stdout??''}${result.stderr?`\nSTDERR\n${result.stderr}`:''}`).slice(0,MAX_OUTPUT_BYTES);return textResult(`exit=${result.status??-1}\n${output}`,Boolean(result.error));
    }
    throw Object.assign(new Error('TOOL_NOT_FOUND'),{code:-32601});
  };
  return Object.freeze({tools:schemas,call});
}

export function handleToolBrokerMessage(runtime,message){
  if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string')throw Object.assign(new Error('INVALID_REQUEST'),{code:-32600});
  if(message.method==='notifications/initialized')return null;
  if(message.method==='initialize')return {protocolVersion:message.params?.protocolVersion??'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'page-autodev-tool-broker',version:'1.0.0'}};
  if(message.method==='ping')return {};
  if(message.method==='tools/list')return {tools:runtime.tools};
  if(message.method==='tools/call')return runtime.call(message.params?.name,message.params?.arguments??{});
  throw Object.assign(new Error('METHOD_NOT_FOUND'),{code:-32601});
}

export function runToolBrokerStdio({input=process.stdin,output=process.stdout,config}={}){
  const runtime=createToolBrokerRuntime(config);let buffer='';input.setEncoding('utf8');
  input.on('data',chunk=>{buffer+=chunk;if(Buffer.byteLength(buffer)>MAX_FRAME_BYTES&&!buffer.includes('\n')){input.destroy(new Error('MCP_FRAME_TOO_LARGE'));return;}let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;let request;try{request=JSON.parse(line);const result=handleToolBrokerMessage(runtime,request);if(result!==null&&request.id!==undefined)output.write(`${JSON.stringify({jsonrpc:'2.0',id:request.id,result})}\n`);}catch(error){if(request?.id!==undefined)output.write(`${JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:Number(error.code)||-32000,message:String(error.message||'TOOL_ERROR')}})}\n`);}}});
  return runtime;
}
