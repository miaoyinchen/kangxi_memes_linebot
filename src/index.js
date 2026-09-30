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
              "SELECT keyword, artist, image_url FROM memes ORDER BY RANDOM() LIMIT 1"
            ).first();

            if (result) {
              await sendImageWithInfo(replyToken, result, env.LINE_CHANNEL_ACCESS_TOKEN);
            } else {
              await replyMessage(replyToken, [
                { type: "text", text: "資料庫目前沒有圖片" }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            }
            continue;
          }

          // ===== 特殊指令：藝人列表 =====
          if (userInput === "藝人列表") {
            const results = await env.DB.prepare(`
              SELECT artist 
              FROM memes 
              WHERE artist IS NOT NULL AND artist != ''
            `).all();
          
            const rows = results.results || [];
          
            if (rows.length === 0) {
              await replyMessage(replyToken, [
                { type: "text", text: "目前資料庫沒有藝人資料" }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            } else {
              // 用來統計每個藝人的張數
              const artistCount = {};
          
              for (const row of rows) {
                // 用空白拆開多個藝人
                const artists = row.artist.trim().split(/\s+/);
          
                for (const name of artists) {
                  if (name) {  // 避免空字串
                    artistCount[name] = (artistCount[name] || 0) + 1;
                  }
                }
              }
          
              // 轉成陣列並依照張數由多到少排序
              const sorted = Object.entries(artistCount)
                .sort((a, b) => b[1] - a[1]);
          
              let listText = "現在資料庫有\n";
              listText += sorted
                .map(([name, count]) => `${name}: ${count}張`)
                .join("\n");
          
              await replyMessage(replyToken, [
                { type: "text", text: listText }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            }
            continue;
          }

          // ===== 特殊指令：指令說明 =====
          if (userInput === "指令說明") {
            const helpText = `【康熙梗圖機器人使用說明】

🔍 直接輸入圖片關鍵字或編號
  關鍵字短一點 成功率比較高喔

📺 輸入 @藝人名字
  例如 @蔡康永
  → 列出有關該藝人的梗圖列表
  一定要加@ 才會觸發藝人的搜尋
  否則只會搜尋圖片名稱而已
  *不是每張圖片都有對應的藝人`;

            await replyMessage(replyToken, [
              { type: "text", text: helpText }
            ], env.LINE_CHANNEL_ACCESS_TOKEN);
            continue;
          }

          // ===== @藝人搜尋 =====
          if (userInput.startsWith("@") && userInput.length > 1) {
            const artistName = userInput.slice(1).trim();

            const results = await env.DB.prepare(
              "SELECT id, keyword FROM memes WHERE artist LIKE ?"
            ).bind(`%${artistName}%`).all();

            const rows = results.results || [];

            if (rows.length === 0) {
              await replyMessage(replyToken, [
                { type: "text", text: "沒有找到這個藝人的圖片" }
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
              "SELECT keyword, artist, image_url FROM memes WHERE id = ?"
            ).bind(userInput).first();

            if (result) {
              await sendImageWithInfo(replyToken, result, env.LINE_CHANNEL_ACCESS_TOKEN);
            } else {
              await replyMessage(replyToken, [
                { type: "text", text: "沒找到欸...換換其他關鍵字或編號" }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            }
          } else {
            // ===== 關鍵字部分符合查詢 =====
            const results = await env.DB.prepare(
              "SELECT id, keyword, artist, image_url FROM memes WHERE keyword LIKE ?"
            ).bind(`%${userInput}%`).all();

            const rows = results.results || [];

            if (rows.length === 0) {
              await replyMessage(replyToken, [
                { type: "text", text: "沒找到欸...換換其他關鍵字或編號" }
              ], env.LINE_CHANNEL_ACCESS_TOKEN);
            } else if (rows.length === 1) {
              await sendImageWithInfo(replyToken, rows[0], env.LINE_CHANNEL_ACCESS_TOKEN);
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

// 發送圖片 + 文字資訊
async function sendImageWithInfo(replyToken, data, accessToken) {
  const artistText = data.artist ? data.artist : "無資料";

  const infoText = `圖片名稱: ${data.keyword}
藝人: ${artistText}`;

  await replyMessage(replyToken, [
    {
      type: "image",
      originalContentUrl: data.image_url,
      previewImageUrl: data.image_url
    },
    {
      type: "text",
      text: infoText
    }
  ], accessToken);
}

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
              label: "藝人列表",
              text: "藝人列表"
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
