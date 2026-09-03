// Privacy-модуль rules-mvp-0.1 (T-09). Порядок — по ruleId реестра.

import type { Rule } from '../engine/types.js';
import { privacy001Cookies } from './privacy-001.js';
import { privacy003ThirdPartyScripts } from './privacy-003.js';

export const PRIVACY_RULES: readonly Rule[] = [privacy001Cookies, privacy003ThirdPartyScripts];
