#!/usr/bin/env node
import { alpha } from './a.js';
import { ping } from './ping.js';
import './register.js';

console.log(alpha('cli'), ping(3));
