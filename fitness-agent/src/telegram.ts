const telegramApi = (token: string) => `https://api.telegram.org/bot${token}`;

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  parseMode: 'Markdown' | 'HTML' | 'MarkdownV2' = 'Markdown',
): Promise<void> {
  await fetch(`${telegramApi(token)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
}

export async function sendTyping(token: string, chatId: number): Promise<void> {
  await fetch(`${telegramApi(token)}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });
}

export async function setWebhook(token: string, webhookUrl: string, secret: string): Promise<unknown> {
  const response = await fetch(`${telegramApi(token)}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, secret_token: secret }),
  });
  return response.json();
}
