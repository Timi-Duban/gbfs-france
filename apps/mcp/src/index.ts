#!/usr/bin/env node
import { createGbfsFrance } from '@gbfs-france/core';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { USER_AGENT, createServer } from './server';

// stdout carries protocol messages only: log to stderr.
const server = createServer(createGbfsFrance({ headers: { 'User-Agent': USER_AGENT } }));
await server.connect(new StdioServerTransport());
console.error(`gbfs-france-mcp ready (${USER_AGENT})`);
