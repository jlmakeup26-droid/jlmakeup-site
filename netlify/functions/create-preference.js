const CATALOG = {
  1: { title: "Lip Gloss Triple Glow", price: 19.99 },
  2: { title: "Bruma Fixadora Facial", price: 9.99 },
  3: { title: "Cílios Postiços", price: 17.99 },
  4: { title: "Água Micelar com AH + Vitamina E", price: 13.80 },
  5: { title: "Body Splash Lovely 100ml", price: 9.99 },
  6: { title: "Kit de Pincéis", price: 17.97 },
  7: { title: "Sabonete Líquido 200ml", price: 9.99 },
  8: { title: "Modeladora de Sobrancelha", price: 9.99 }
};

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Método não permitido." })
    };
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Mercado Pago ainda não foi configurado." })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const receivedItems = Array.isArray(body.items) ? body.items : [];

    if (!receivedItems.length) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Carrinho vazio." })
      };
    }

    const items = receivedItems.map(item => {
      const id = Number(item.id);
      const qty = Math.max(1, Math.min(20, Number(item.qty) || 1));
      const product = CATALOG[id];

      if (!product) {
        throw new Error(`Produto inválido: ${id}`);
      }

      return {
        id: String(id),
        title: product.title,
        quantity: qty,
        currency_id: "BRL",
        unit_price: product.price
      };
    });

    const siteUrl = process.env.URL || event.headers.origin || "https://example.com";

    const preference = {
      items,
      external_reference: `JLMAKEUP-${Date.now()}`,
      statement_descriptor: "JLMAKEUP",
      payment_methods: {
        installments: 12
      },
      back_urls: {
        success: `${siteUrl}/sucesso.html`,
        pending: `${siteUrl}/pendente.html`,
        failure: `${siteUrl}/falha.html`
      },
      auto_return: "approved"
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preference)
    });

    const data = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("Mercado Pago:", data);
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Não foi possível criar o pagamento." })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkout_url: data.init_point })
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Pedido inválido." })
    };
  }
};
