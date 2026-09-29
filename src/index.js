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
            const results = await 
