export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("OK");
    }

    const bodyText = await request.text();
    const signature = request.headers.get("x-line-signature");

    // 驗證簽名
    const isValid = await verifySignature(bodyText, signature, env.LINE_CHANNEL_SECRET);
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const body = JSON.parse(bodyText);

    if (body.events && body.events.length > 0) {
      for (const event of body.events) {
        if (event.type === "message" && event.message.type === "text") {
          const userInput = event.message.text.trim();
          const replyToken = event.replyToken;

          // 判斷是否為純數字 id
          const isId = /^\d+$/.test(userInput);

          if (isId) {
            // ===== 用 id 精確查詢 =====
            const result = await env.DB.prepare(
              "SELECT image_url FROM memes WHERE id = ?"
            ).bind(userInput).first();

            if (result) {
              await replyMessage(replyToken, [
                {
                  type: "image",
                  originalContentUrl: result.image_url,
                  previewImageUrl: result.image_url
                }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            } else {
              await replyMessage(replyToken, [
                { type: "text", text: "沒有這張圖片" }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            }
          } else {
            // ===== 關鍵字部分符合查詢（LIKE %關鍵字%） =====
            const results = await env.DB.prepare(
              "SELECT id, keyword, image_url FROM memes WHERE keyword LIKE ?"
            ).bind(`%${userInput}%`).all();

            const rows = results.results || [];

            if (rows.length === 0) {
              await replyMessage(replyToken, [
                { type: "text", text: "沒有這張圖片" }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            } else if (rows.length === 1) {
              // 只有一張 → 直接傳圖片
              await replyMessage(replyToken, [
                {
                  type: "image",
                  originalContentUrl: rows[0].image_url,
                  previewImageUrl: rows[0].image_url
                }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            } else {
              // 多張符合 → 回傳列表
              const listText = rows
                .map(row => `【${row.id}】${row.keyword}`)
                .join("\n");

              await replyMessage(replyToken, [
                { type: "text", text: listText }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            }
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
