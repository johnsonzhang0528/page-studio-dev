import net from 'node:net';import {createFixedTunnelServer} from '../lib/dataforseo-fixed-tunnel.mjs';net.createServer(createFixedTunnelServer()).listen({fd:3});
