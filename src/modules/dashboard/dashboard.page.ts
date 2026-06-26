// Página do painel — HTML/CSS/JS autocontidos (sem build, sem dependências).
// Todos os dados vêm da API /api/dashboard via fetch no cliente.
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Voltta · Painel</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --muted:#94a3b8; --txt:#e2e8f0; --line:#334155;
          --green:#22c55e; --amber:#f59e0b; --red:#ef4444; --blue:#3b82f6; --accent:#8b5cf6; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt);
         font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  header { display:flex; align-items:center; gap:12px; flex-wrap:wrap;
           padding:18px 24px; border-bottom:1px solid var(--line); }
  header h1 { font-size:18px; margin:0; }
  header .sub { color:var(--muted); font-size:13px; }
  .badge { padding:2px 10px; border-radius:999px; font-size:12px; font-weight:600; }
  .badge.mock { background:#7c2d12; color:#fdba74; }
  .badge.real { background:#14532d; color:#86efac; }
  .spacer { flex:1; }
  .wrap { padding:24px; max-width:1100px; margin:0 auto; }
  .grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .card .k { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:28px; font-weight:700; margin-top:6px; }
  .card .v.small { font-size:18px; }
  h2 { font-size:14px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em;
       margin:28px 0 10px; }
  table { width:100%; border-collapse:collapse; background:var(--card);
          border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th,td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); font-size:13px; }
  th { color:var(--muted); font-weight:600; background:#172033; }
  tr:last-child td { border-bottom:none; }
  .pill { padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; white-space:nowrap; }
  .s-AWAITING_PAYMENT { background:#78350f; color:#fcd34d; }
  .s-PAID { background:#14532d; color:#86efac; }
  .s-CANCELED { background:#3f1d1d; color:#fca5a5; }
  .s-UNKNOWN { background:#334155; color:#cbd5e1; }
  .r-PENDING { background:#1e3a8a; color:#bfdbfe; }
  .r-SENT { background:#14532d; color:#86efac; }
  .r-SKIPPED_PAID { background:#334155; color:#cbd5e1; }
  .r-FAILED { background:#3f1d1d; color:#fca5a5; }
  .muted { color:var(--muted); }
  .empty { color:var(--muted); padding:24px; text-align:center; }
  .err { background:#3f1d1d; color:#fca5a5; padding:16px; border-radius:12px; margin-top:16px; }
  a { color:#a78bfa; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .dot.on { background:var(--green); } .dot.off { background:var(--red); }
</style>
</head>
<body>
<header>
  <h1>🛒➡️💬 Voltta</h1>
  <span id="storeName" class="sub"></span>
  <span id="modeBadge"></span>
  <div class="spacer"></div>
  <span id="updated" class="sub"></span>
</header>
<div class="wrap">
  <div id="error"></div>

  <div class="grid" id="cards"></div>

  <h2>Recuperação</h2>
  <div class="grid" id="recoveryCards"></div>

  <h2>Pedidos recentes</h2>
  <div id="ordersWrap"></div>

  <h2>Mensagens enviadas</h2>
  <div id="messagesWrap"></div>

  <p class="muted" style="margin-top:24px">Atualiza automaticamente a cada 15s.
     <a href="#" onclick="load();return false">Atualizar agora</a></p>
</div>
<script>
  var token = new URLSearchParams(location.search).get('token') || '';
  function api() { return '/api/dashboard' + (token ? '?token=' + encodeURIComponent(token) : ''); }
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function money(n){ return n==null?'—':n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
  function dt(s){ try { return new Date(s).toLocaleString('pt-BR'); } catch(e){ return s; } }
  function card(k,v,small){ return '<div class="card"><div class="k">'+k+'</div><div class="v'+
    (small?' small':'')+'">'+v+'</div></div>'; }

  function render(d){
    document.getElementById('error').innerHTML = '';
    document.getElementById('storeName').textContent =
      d.store ? d.store.name + ' · último pedido visto: #' + d.store.lastSeenOrderNumber : 'sem loja';
    document.getElementById('modeBadge').innerHTML = d.config.mock
      ? '<span class="badge mock">MOCK</span>'
      : '<span class="badge real">PRODUÇÃO (LI real)</span>';
    document.getElementById('updated').textContent = 'Atualizado ' + dt(d.generatedAt);

    var evo = d.store && d.store.evolutionConfigured;
    document.getElementById('cards').innerHTML =
      card('Total de pedidos', d.stats.totalOrders) +
      card('Aguardando pgto', d.stats.status.awaitingPayment) +
      card('Pagos', d.stats.status.paid) +
      card('Cancelados', d.stats.status.canceled) +
      card('Evolution (WhatsApp)',
        '<span class="dot '+(evo?'on':'off')+'"></span>'+(evo?'ativa':'pendente'), true);

    document.getElementById('recoveryCards').innerHTML =
      card('Na fila (espera)', d.stats.recovery.pending) +
      card('Mensagens enviadas', d.stats.recovery.sent) +
      card('Pagou antes do envio', d.stats.recovery.skippedPaid) +
      card('Falhas no envio', d.stats.recovery.failed);

    // Pedidos
    var o = d.recentOrders;
    if (!o.length) { document.getElementById('ordersWrap').innerHTML =
      '<div class="card empty">Nenhum pedido capturado ainda.</div>'; }
    else {
      var rows = o.map(function(x){ return '<tr>'+
        '<td>#'+esc(x.liOrderId)+'</td>'+
        '<td>'+esc(x.customerName||'—')+'<div class="muted">'+esc(x.customerPhone||'')+'</div></td>'+
        '<td>'+esc(x.productSummary||'—')+'</td>'+
        '<td>'+money(x.totalAmount)+'</td>'+
        '<td><span class="pill s-'+esc(x.status)+'">'+esc(x.status)+'</span></td>'+
        '<td><span class="pill r-'+esc(x.recoveryStatus)+'">'+esc(x.recoveryStatus)+'</span></td>'+
        '<td class="muted">'+dt(x.createdAt)+'</td></tr>'; }).join('');
      document.getElementById('ordersWrap').innerHTML =
        '<table><thead><tr><th>Pedido</th><th>Cliente</th><th>Produto</th><th>Valor</th>'+
        '<th>Situação</th><th>Recuperação</th><th>Capturado</th></tr></thead><tbody>'+rows+'</tbody></table>';
    }

    // Mensagens
    var m = d.recentMessages;
    if (!m.length) { document.getElementById('messagesWrap').innerHTML =
      '<div class="card empty">Nenhuma mensagem enviada ainda.</div>'; }
    else {
      var mr = m.map(function(x){ return '<tr>'+
        '<td>#'+esc(x.liOrderId)+'</td>'+
        '<td>'+esc(x.customerName||'—')+'</td>'+
        '<td>'+(x.success?'<span class="pill r-SENT">enviada</span>':
                '<span class="pill r-FAILED">falhou</span>')+
          (x.error?'<div class="muted">'+esc(x.error)+'</div>':'')+'</td>'+
        '<td class="muted">'+dt(x.sentAt)+'</td></tr>'; }).join('');
      document.getElementById('messagesWrap').innerHTML =
        '<table><thead><tr><th>Pedido</th><th>Cliente</th><th>Status</th><th>Quando</th>'+
        '</tr></thead><tbody>'+mr+'</tbody></table>';
    }
  }

  function load(){
    fetch(api()).then(function(r){
      if (r.status === 401) throw new Error('Acesso negado. Abra a URL com ?token=SEU_TOKEN');
      if (!r.ok) throw new Error('Erro ' + r.status);
      return r.json();
    }).then(render).catch(function(e){
      document.getElementById('error').innerHTML = '<div class="err">'+esc(e.message)+'</div>';
    });
  }
  load();
  setInterval(load, 15000);
</script>
</body>
</html>`;
}
