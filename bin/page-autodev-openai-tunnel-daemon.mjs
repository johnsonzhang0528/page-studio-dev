#!/usr/bin/env node
import net from 'node:net';
import { createFixedTunnelServer } from '../lib/fixed-egress-tunnel.mjs';
const server=net.createServer(createFixedTunnelServer());server.listen({fd:3});
const stop=()=>server.close(()=>process.exit(0));process.once('SIGTERM',stop);process.once('SIGINT',stop);
