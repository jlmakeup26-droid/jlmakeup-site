const { getQuote } = require("./shipping-quote.js");

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

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

function cleanCep(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function sanitizeText(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function validateCustomer(customer) {
  if (!customer || typeof customer !== "object") return "Dados do cliente não enviados.";
  if (sanitizeText(customer.name).length < 3) return "Nome do cliente inválido.";
  if (String(customer.phone || "").replace(/\D/g, "").length < 10) return "Telefone inválido.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer.email || ""))) return "E-mail inválido.";

  const address = customer.address || {};
  if (cleanCep(address.postal_code).length !== 8) return "CEP inválido.";
  if (!sanitizeText(address.street)) return "Rua inválida.";
  if (!sanitizeText(address.number)) return "Número inválido.";
  if (!sanitizeText(address.neighborhood)) return "Bairro inválido.";
  if (!sanitizeText(address.city)) return "Cidade inválida.";
  if (sanitizeText(address.state, 2).length !== 2) return "UF inválida.";
  return null;
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Método não permitido." });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return json(500, { error: "Mercado Pago ainda não foi configurado." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const receivedItems = Array.isArray(body.items) ? body.items : [];
    const customer = body.customer;
    const requestedServiceId = String(body.shipping?.service_id || "");

    if (!receivedItems.length) {
      return json(400, { error: "Carrinho vazio." });
    }

    const customerError = validateCustomer(customer);
    if (customerError) {
      return json(400, { error: customerError });
    }

    if (!requestedServiceId) {
      return json(400, { error: "Selecione uma modalidade de frete." });
    }

    const items = receivedItems.map(item => {
      const id = Number(item.id);
      const qty = Math.max(1, Math.min(20, Number(item.qty) || 1));
      const product = CATALOG[id];

      if (!product) throw new Error(`Produto inválido: ${id}`);

      return {
        id: String(id),
        title: product.title,
        quantity: qty,
        currency_id: "BRL",
        unit_price: product.price
      };
    });

    // Segurança: o valor do frete NÃO é aceito do navegador.
    // Recalculamos na SuperFrete usando o CEP e o serviço escolhido.
    const postalCode = cleanCep(customer.address.postal_code);
    const freshQuotes = await getQuote(postalCode);
    const selectedShipping =
      freshQuotes.find(q => String(q.id) === requestedServiceId) ||
      freshQuotes.find(q => String(q.name) === requestedServiceId);

    if (!selectedShipping) {
      return json(400, { error: "A modalidade de frete escolhida não está mais disponível. Calcule o frete novamente." });
    }

    items.push({
      id: `frete-${selectedShipping.id || "entrega"}`,
      title: `Frete - ${selectedShipping.company ? selectedShipping.company + " " : ""}${selectedShipping.name}`,
      quantity: 1,
      currency_id: "BRL",
      unit_price: Number(selectedShipping.price)
    });

    const siteUrl = process.env.URL || event.headers.origin || "https://jlmakeup-oficial.netlify.app";

    const preference = {
      items,
      external_reference: `JLMAKEUP-${Date.now()}`,
      statement_descriptor: "JLMAKEUP",
      payment_methods: {
        installments: 12
      },
      metadata: {
        customer_name: sanitizeText(customer.name, 120),
        customer_email: sanitizeText(customer.email, 120),
        customer_phone: sanitizeText(customer.phone, 30),
        shipping_postal_code: postalCode,
        shipping_street: sanitizeText(customer.address.street),
        shipping_number: sanitizeText(customer.address.number, 30),
        shipping_complement: sanitizeText(customer.address.complement, 80),
        shipping_neighborhood: sanitizeText(customer.address.neighborhood, 80),
        shipping_city: sanitizeText(customer.address.city, 80),
        shipping_state: sanitizeText(customer.address.state, 2).toUpperCase(),
        shipping_service_id: sanitizeText(selectedShipping.id, 30),
        shipping_service_name: sanitizeText(selectedShipping.name, 80),
        shipping_company: sanitizeText(selectedShipping.company, 80),
        shipping_price: Number(selectedShipping.price)
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
      return json(502, {
        error: data?.message || "Não foi possível criar o pagamento."
      });
    }

    return json(200, {
      checkout_url: data.init_point,
      shipping: selectedShipping
    });
  } catch (error) {
    console.error(error);
    return json(400, { error: error.message || "Pedido inválido." });
  }
};
