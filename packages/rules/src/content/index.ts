// Content Quality-модуль rules-mvp-0.1 (T-09). Порядок — по ruleId реестра.

import type { Rule } from '../engine/types.js';
import { content003LowValuePages } from './content-003.js';
import { content004BrokenMedia } from './content-004.js';

export const CONTENT_RULES: readonly Rule[] = [content003LowValuePages, content004BrokenMedia];
