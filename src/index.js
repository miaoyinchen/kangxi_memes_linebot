export default {
  async fetch(request, env, ctx) {
    // 只接受 POST（LINE Webhook 會用 POST）
    if (request.method !== "POST") {
      return new Response("OK");
    }

    const bodyText = await request.text();
    const signature = request.headers.get("x-line-signature");

    // 驗證簽名（重要，防止偽造請求）
    const isValid = await verifySignature(bodyText, signature, env.LINE_CHANNEL_SECRET);
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const body = JSON.parse(bodyText);

    // 處理每一個事件
    if (body.events && body.events.length > 0) {
      for (const event of body.events) {
        if (event.type === "message" && event.message.type === "text") {
          const keyword = event.message.text.trim();
          const replyToken = event.replyToken;

          // 查詢資料庫
          const result = await env.DB.prepare(
            "SELECT image_url, description FROM memes WHERE keyword = ? LIMIT 1"
          ).bind(keyword).first();

          if (result) {
            // 找到梗圖 → 回傳圖片 + 文字
            await replyMessage(replyToken, [
              {
                type: "image",
                originalContentUrl: result.image_url,
                previewImageUrl: result.image_url
              },
              {
                type: "text",
                text: result.description || "這是相關梗圖"
              }
            ], env.LINE_CHANNEL_ACCESS_TOKEN);
          } else {
            // 找不到
            await replyMessage(replyToken, [
              {
                type: "text",
                text: `找不到「${keyword}」相關的梗圖喔～`
              }
            ], env.LINE_CHANNEL_ACCESS_TOKEN);
          }
        }
      }
    }

    return new Response("OK");
  }
};

// 驗證 LINE 簽名
async function verifySignature(body, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

// 回覆訊息給 LINE
async function replyMessage(replyToken, messages, accessToken) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      replyToken: replyToken,
      messages: messages
    })
  });
}
