#!/usr/bin/env node
/**
 * Send a one-way text message to WeChat (no reply expected).
 *
 * Usage:
 *   node send-weixin.mjs "消息内容"
 *   echo "消息内容" | node send-weixin.mjs     # read from stdin
 *
 * Exit code 0 = success, 1 = failure.
 */

import { loadWeixinAccount, loadContextToken, sendMessage } from '../lib/weixin-client.mjs';

const log = (...args) => process.stderr.write('[send-weixin] ' + args.join(' ') + '\n');

async function main() {
  // Get message text from args or stdin
  let text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    // Try reading from stdin
    const chunks = [];
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    text = chunks.join('').trim();
  }

  if (!text) {
    log('Error: No message text provided.');
    process.exit(1);
  }

  let account;
  try {
    account = loadWeixinAccount();
  } catch (err) {
    log(`Error: ${err.message}`);
    process.exit(1);
  }

  const contextToken = loadContextToken(account.accountId);

  log(`Sending: ${text.slice(0, 100)}`);

  try {
    const result = await sendMessage(account, account.userId, text, contextToken);
    log(`Sent OK (msg_id: ${result.message_id || '?'})`);
  } catch (err) {
    log(`Failed: ${err.message}`);
    process.exit(1);
  }
}

main();