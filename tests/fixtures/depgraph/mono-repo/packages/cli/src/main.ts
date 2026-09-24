#!/usr/bin/env node
import { add } from '@scope/core';
import { format } from './format.js';

console.log(format(add([2, 3])));
