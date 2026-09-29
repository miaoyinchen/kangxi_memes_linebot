export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("OK");
    }

    const bodyText = await request.text();
    const signature = request.headers.get("x-line-signature");

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

          // ===== 特殊指令：抽 =====
          if (userInput === "抽") {
            const result = await env.DB.prepare(
              "SELECT image_url FROM memes ORDER BY RANDOM() LIMIT 1"
            ).first();

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
                { type: "text", text: "資料庫目前沒有圖片" }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            }
            continue;
          }

          // ===== 特殊指令：指令說明 =====
          if (userInput === "指令說明") {
            const helpText = `【康熙梗圖機器人使用說明】

1. 直接輸入關鍵字（支援部分符合）
   → 找到 1 張：直接傳圖片
   → 找到多張：回傳列表，再輸入 id 選擇

2. 直接輸入數字 id
   → 立即傳對應圖片

3. 輸入 @藝人名字（例如 @沈玉琳）
   → 列出該藝人相關的梗圖列表

4. 點擊下方「抽」
   → 隨機傳一張梗圖

5. 點擊下方「指令說明」
   → 再次查看本說明`;

            await replyMessage(replyToken, [
              { type: "text", text: helpText }
            ], env.LINE_CHANNEL_ACCESS_TOKEN);
            continue;
          }

          // ===== 新增功能：@藝人搜尋 =====
          if (userInput.startsWith("@") && userInput.length > 1) {
            const artistName = userInput.slice(1).trim(); // 去掉 @ 符號

            const results = await env.DB.prepare(
              "SELECT id, keyword FROM memes WHERE artist LIKE ?"
            ).bind(`%${artistName}%`).all();

            const rows = results.results || [];

            if (rows.length === 0) {
              await replyMessage(replyToken, [
                { type: "text", text: "沒有找到這個藝人的梗圖" }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            } else {
              const listText = rows
                .map(row => `【${row.id}】${row.keyword}`)
                .join("\n");

              await replyMessage(replyToken, [
                { type: "text", text: listText }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            }
            continue;
          }

          // ===== 判斷是否為純數字 id =====
          const isId = /^\d+$/.test(userInput);

          if (isId) {
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
            // ===== 關鍵字部分符合查詢 =====
            const results = await env.DB.prepare(
              "SELECT id, keyword, image_url FROM memes WHERE keyword LIKE ?"
            ).bind(`%${userInput}%`).all();

            const rows = results.results || [];

            if (rows.length === 0) {
              await replyMessage(replyToken, [
                { type: "text", text: "沒有這張圖片" }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            } else if (rows.length === 1) {
              await replyMessage(replyToken, [
                {
                  type: "image",
                  originalContentUrl: rows[0].image_url,
                  previewImageUrl: rows[0].image_url
                }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            } else {
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

// 回覆訊息（每次都附上 Quick Reply）
async function replyMessage(replyToken, messages, accessToken) {
  const messagesWithQuickReply = messages.map(msg => {
    return {
      ...msg,
      quickReply: {
        items: [
          {
            type: "action",
            action: {
              type: "message",
              label: "抽",
              text: "抽"
            }
          },
          {
            type: "action",
            action: {
              type: "message",
              label: "指令說明",
              text: "指令說明"
            }
          }
        ]
      }
    };
  });

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      replyToken: replyToken,
      messages: messagesWithQuickReply
    })
  });
}
