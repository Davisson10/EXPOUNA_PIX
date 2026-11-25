// Pix na cidade · réplica do notebook da prática (Sistemas Distribuídos e Mobile · ExpoUNA)
// Só frontend: busca IBGE, SIDRA e Banco Central direto do navegador (todos aceitam CORS).

// Autores que aparecem no cabeçalho do banner (edite aqui)
const AUTORES = "Davisson Henrique • Giovane Pereira • Nathan William • Pedro Henrique Silva • Raul Adelino • Victor Augusto • Wender Samuel";

// ===================== Utilidades =====================

// AAAAMM de hoje (ex.: 202611)
function mesAtual() {
  const hoje = new Date();
  return hoje.getFullYear() * 100 + (hoje.getMonth() + 1);
}

const esperar = ms => new Promise(ok => setTimeout(ok, ms));

// Cache no localStorage (try/catch: o navegador pode bloquear ou estar cheio)
function lerCache(chave) {
  try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; }
}
function gravarCache(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem cache, segue */ }
}

// Arquivo salvo junto com o site (pasta data/). Retorna null se não existir.
async function lerArquivoLocal(caminho) {
  try {
    const res = await fetch(caminho);
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
}

// Fica true quando uma chamada falha por falta de rede: aí o Banco Central nem é tentado
let semInternet = false;

// Igual ao str.title() do Python: primeira letra de cada palavra em maiúscula
function titleCase(texto) {
  return texto.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, antes, letra) => antes + letra.toUpperCase());
}

// 202011 -> "11/2020"
function anoMesParaTexto(anoMes) {
  const mes = String(anoMes % 100).padStart(2, "0");
  return `${mes}/${(anoMes / 100) | 0}`;
}

// Date -> "MM/AAAA"
function dataParaTexto(data) {
  return `${String(data.getMonth() + 1).padStart(2, "0")}/${data.getFullYear()}`;
}

// Lança um erro com o status HTTP e a mensagem da API
async function erroHttp(res, api) {
  let mensagem = res.statusText || "erro desconhecido";
  try {
    const texto = await res.text();
    // O Banco Central devolve o erro dentro de /* ... */
    const json = JSON.parse(texto.replace(/^\s*\/\*/, "").replace(/\*\/\s*$/, ""));
    mensagem = json.mensagem || json.message || mensagem;
  } catch (e) { /* corpo sem JSON: fica o statusText */ }
  const erro = new Error(`${api} respondeu ${res.status}: ${mensagem}`);
  erro.status = res.status;
  erro.api = api;
  erro.mensagem = mensagem;
  return erro;
}

// ===================== 2.1 a 2.8: funções do notebook =====================

// 2.1 Código IBGE da cidade
async function buscarCodigo(cidade, uf, log) {
  // A lista de municípios não muda: guarda só id e nome no cache
  const chave = `ibge_mun_${uf}`;
  let municipios = lerCache(chave);
  if (!municipios) {
    try {
      const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`;
      const res = await fetch(url);
      if (!res.ok) throw await erroHttp(res, "IBGE");
      municipios = (await res.json()).map(m => ({ id: m.id, nome: m.nome }));
      gravarCache(chave, municipios);
    } catch (erro) {
      if (erro instanceof TypeError) semInternet = true; // falha de rede
      municipios = await lerArquivoLocal(`data/municipios-${uf}.json`);
      if (!municipios) throw erro;
    }
  }

  for (const m of municipios) {
    if (m.nome.toLowerCase() === cidade.toLowerCase()) {
      log.push(`${m.nome}/${uf} → código IBGE ${m.id}`);
      return m.id;
    }
  }
  log.push(`Cidade não encontrada: ${titleCase(cidade)}/${uf}`);
  return null;
}

// 2.2 População do Censo 2022 (SIDRA, tabela 4709)
async function buscarPopulacao(codigo, log) {
  // O Censo 2022 não muda: usa o cache se tiver
  const chave = `ibge_pop_${codigo}`;
  let pop = lerCache(chave);
  if (!pop) {
    try {
      const url = `https://apisidra.ibge.gov.br/values/t/4709/n6/${codigo}/v/93/p/2022`;
      const res = await fetch(url);
      if (!res.ok) throw await erroHttp(res, "SIDRA");
      const dados = await res.json();
      pop = parseInt(dados[1].V); // a linha 0 é o cabeçalho
      gravarCache(chave, pop);
    } catch (erro) {
      if (erro instanceof TypeError) semInternet = true;
      const snapshot = await lerArquivoLocal(`data/pix-${codigo}.json`);
      if (!snapshot) throw erro;
      pop = snapshot.populacao;
    }
  }
  log.push(`População (Censo 2022): ${pop} habitantes`);
  return pop;
}

// Uma requisição ao Banco Central, com timeout de 180 s
async function tentarPix(url) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), 180000);
  try {
    const res = await fetch(url, { signal: controle.signal });
    if (!res.ok) throw await erroHttp(res, "Banco Central");
    return (await res.json()).value;
  } catch (e) {
    if (e.name === "AbortError") {
      const erro = new Error("Banco Central não respondeu em 180 s");
      erro.api = "Banco Central";
      throw erro;
    }
    throw e;
  } finally {
    clearTimeout(relogio);
  }
}

// 2.3 Transações Pix do município (Banco Central)
// Ordem: cache do mês → até 3 tentativas na API → arquivo salvo em data/
async function buscarPix(codigo, log) {
  const chave = `pix_${codigo}_${mesAtual()}`;
  const cache = lerCache(chave);
  if (cache) {
    log.push(`Banco Central: ${cache.length} meses (cache local)`);
    return cache;
  }

  const url = encodeURI(
    "https://olinda.bcb.gov.br/olinda/servico/Pix_DadosAbertos/versao/v1/odata/" +
    "TransacoesPixPorMunicipio(DataBase=@DataBase)?@DataBase='202011'&$format=json" +
    `&$filter=Municipio_Ibge eq ${codigo}` +
    "&$select=AnoMes,Municipio_Ibge,QT_PagadorPF,VL_PagadorPF,QT_PES_PagadorPF"
  );

  let ultimoErro = null;
  if (!semInternet) {
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      if (tentativa > 1) {
        await esperar(tentativa === 2 ? 3000 : 6000); // espera 3 s e depois 6 s
        log.push(`Banco Central: tentativa ${tentativa} de 3...`);
      }
      try {
        const valores = await tentarPix(url);
        log.push(`Banco Central: ${valores.length} meses recebidos para o município ${codigo}`);
        gravarCache(chave, valores);
        return valores;
      } catch (erro) {
        ultimoErro = erro;
        log.push(`  falhou: ${erro.message}`);
        if (erro instanceof TypeError && !navigator.onLine) { semInternet = true; break; }
        if (erro.status >= 400 && erro.status < 500) break; // erro do pedido: repetir não adianta
      }
    }
  }

  // Plano B: dados salvos pelo scripts/gerar-snapshot.mjs
  const snapshot = await lerArquivoLocal(`data/pix-${codigo}.json`);
  if (snapshot) {
    const dia = new Date(snapshot.gerado_em).toLocaleDateString("pt-BR");
    log.push(`Banco Central indisponível — usando dados salvos em ${dia}`);
    return snapshot.value;
  }
  throw ultimoErro || new Error("Sem internet e sem dados salvos deste município.");
}

// 2.4 Ordena e tira o mês atual (incompleto)
function prepararSerie(bruta, log) {
  const serie = [...bruta]
    .sort((a, b) => a.AnoMes - b.AnoMes)
    .filter(linha => linha.AnoMes < mesAtual());
  log.push(`Série pronta: ${serie.length} meses completos, de ${serie[0].AnoMes} a ${serie[serie.length - 1].AnoMes}`);
  return serie;
}

// 2.5 Medidas por mês
function calcularMedidas(serie, pop, log) {
  const medidas = { datas: [], pix: [], pct_populacao: [], pix_por_pessoa: [], valor_medio: [] };

  for (const linha of serie) {
    const data = new Date((linha.AnoMes / 100) | 0, (linha.AnoMes % 100) - 1, 1);
    const pix = Number(linha.QT_PagadorPF);
    const pct = Number(linha.QT_PES_PagadorPF) / pop * 100;
    const ppp = Number(linha.QT_PagadorPF) / Number(linha.QT_PES_PagadorPF);
    const vm = Number(linha.VL_PagadorPF) / Number(linha.QT_PagadorPF);

    medidas.datas.push(data);
    medidas.pix.push(pix);
    medidas.pct_populacao.push(pct);
    medidas.pix_por_pessoa.push(ppp);
    medidas.valor_medio.push(vm);

    log.push(`${anoMesParaTexto(linha.AnoMes)}: ${pix} Pix | ${pct.toFixed(1)}% da população | ${ppp.toFixed(1)} Pix por pessoa | R$ ${vm.toFixed(2)} por Pix`);
  }
  return medidas;
}

// 2.6 Tudo em ordem para uma cidade
async function pixNaCidade(cidade, uf) {
  const log = [];
  const nomeCidade = `${titleCase(cidade)}/${uf}`;
  try {
    const codigo = await buscarCodigo(cidade, uf, log);
    if (codigo === null) return { nomeCidade, codigo: null, populacao: null, medidas: null, log };

    const populacao = await buscarPopulacao(codigo, log);
    const bruta = await buscarPix(codigo, log);
    const serie = prepararSerie(bruta, log);
    const medidas = calcularMedidas(serie, populacao, log);
    return { nomeCidade, codigo, populacao, medidas, log };
  } catch (erro) {
    // Guarda o log até o ponto da falha
    erro.log = log;
    erro.nomeCidade = nomeCidade;
    throw erro;
  }
}

// 2.7 Várias cidades, UMA DE CADA VEZ (o BCB derruba requisições simultâneas).
// Uma que falha não derruba as outras; aoTerminar(resultadosAteAgora) mostra cada cidade que fica pronta.
async function compararCidades(lista, aoTerminar = () => {}) {
  const resultados = [];
  for (const c of lista) {
    try {
      resultados.push(await pixNaCidade(c.cidade, c.uf));
    } catch (erro) {
      resultados.push({
        nomeCidade: erro.nomeCidade || `${titleCase(c.cidade)}/${c.uf}`,
        codigo: null, populacao: null, medidas: null,
        log: erro.log || [],
        erro
      });
    }
    aoTerminar(resultados);
  }
  return resultados;
}

// 2.8 Perguntas a–d
function perguntas(medidas) {
  const { datas, pix, pct_populacao, valor_medio } = medidas;
  const iDez2020 = datas.findIndex(d => d.getFullYear() === 2020 && d.getMonth() === 11);

  // a) primeiro mês com mais da metade da população fazendo Pix
  const iMetade = pct_populacao.findIndex(p => p > 50);
  const a = iMetade >= 0 ? dataParaTexto(datas[iMetade]) : "nunca";

  // b) quantas vezes o último mês é maior que dez/2020
  const b = iDez2020 >= 0 ? (pix[pix.length - 1] / pix[iDez2020]).toFixed(1) : "sem dados de 12/2020";

  // c) mês com mais Pix
  let iMax = 0;
  pix.forEach((v, i) => { if (v > pix[iMax]) iMax = i; });
  const c = `${dataParaTexto(datas[iMax])} – ${pix[iMax]}`;

  // d) valor médio em dez/2020
  const d = iDez2020 >= 0 ? `R$ ${valor_medio[iDez2020].toFixed(2)}` : "sem dados de 12/2020";

  return { a, b, c, d };
}

// ===================== 3. Gráficos =====================

const COR_PRIMARIA = "#E60025";
// 1ª cidade na primária Una; demais numa paleta categórica com contraste ≥ 3:1 sobre branco
const PALETA = [COR_PRIMARIA, "#0072B2", "#7D1074", "#00785A", "#B35C00", "#4A5560"];
const FONTE_GRAFICO = '"Open Sans", system-ui, sans-serif';
const FONTE_TITULO = '"Montserrat", system-ui, sans-serif';
const FONTE_RODAPE = "Fonte: Banco Central do Brasil (Pix Dados Abertos) e IBGE (Censo 2022)";

const GRAFICOS = [
  {
    campo: "pix", arquivo: "pix-por-mes.png",
    titulo: "Pix feitos por pessoas", eixoY: "milhões de Pix por mês",
    valor: v => v / 1e6,
    texto: v => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " mi"
  },
  {
    campo: "pct_populacao", arquivo: "pix-populacao.png",
    titulo: "Moradores que fizeram Pix no mês", eixoY: "% da população que fez Pix no mês",
    valor: v => v,
    texto: v => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"
  },
  {
    campo: "valor_medio", arquivo: "pix-valor-medio.png",
    titulo: "Valor médio de um Pix", eixoY: "reais por Pix",
    valor: v => v,
    texto: v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
];

let charts = [];          // charts na tela
let ultimosResultados = []; // para exportar PNG

function hexParaRgba(hex, alfa) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

// Índice do último valor não nulo
function ultimoIndice(dados) {
  for (let i = dados.length - 1; i >= 0; i--) if (dados[i].y !== null) return i;
  return -1;
}

// Plugin: fundo branco (o PNG nunca sai transparente)
const pluginFundoBranco = {
  id: "fundoBranco",
  beforeDraw(chart) {
    const ctx = chart.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  }
};

// Plugin: destaca o último ponto de cada linha com o rótulo do valor
const pluginUltimoPonto = {
  id: "ultimoPonto",
  afterDatasetsDraw(chart, args, opts) {
    const ctx = chart.ctx;
    const esc = opts.escala || 1;
    const rotulos = [];
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      const idx = ultimoIndice(ds.data);
      const ponto = meta.data[idx];
      if (!ponto) return;

      ctx.save();
      ctx.beginPath();
      ctx.arc(ponto.x, ponto.y, 4.5 * esc, 0, Math.PI * 2);
      ctx.fillStyle = ds.borderColor;
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2 * esc;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      rotulos.push({ x: ponto.x, y: ponto.y - 6 * esc, cor: ds.borderColor, texto: opts.texto(ds.data[idx].y) });
    });

    // Afasta rótulos que ficariam um em cima do outro
    const altura = 15 * esc;
    rotulos.sort((a, b) => a.y - b.y);
    for (let i = 1; i < rotulos.length; i++) {
      if (rotulos[i].y - rotulos[i - 1].y < altura) rotulos[i].y = rotulos[i - 1].y + altura;
    }

    ctx.save();
    ctx.font = `700 ${12 * esc}px ${FONTE_GRAFICO}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    rotulos.forEach(r => {
      ctx.fillStyle = r.cor;
      ctx.fillText(r.texto, r.x - 6 * esc, r.y);
    });
    ctx.restore();
  }
};

// Plugin: subtítulo superior (lista de cidades), uma caixa extra no layout abaixo do título
const pluginCidades = {
  id: "cidades",
  beforeInit(chart) {
    const caixa = {
      position: "top", weight: 1500, fullSize: true, options: {},
      left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0,
      isHorizontal: () => true,
      update(larguraMax) {
        const o = chart.options.plugins.cidades;
        this.width = larguraMax;
        this.height = o && o.texto ? o.tamanho * 1.3 + o.espaco : 0;
      },
      draw() {
        const o = chart.options.plugins.cidades;
        if (!o || !o.texto) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = `400 ${o.tamanho}px ${FONTE_GRAFICO}`;
        ctx.fillStyle = "#555A60";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(o.texto, this.left + o.recuo, this.top);
        ctx.restore();
      }
    };
    Chart.layouts.addBox(chart, caixa);
  }
};

// Monta a configuração de um gráfico (escala = 1 na tela; maior no PNG)
function montarConfig(g, resultados, escala = 1) {
  const varias = resultados.length > 1;

  // Eixo x = união dos meses de todas as cidades
  const tempos = [...new Set(resultados.flatMap(r => r.medidas.datas.map(d => d.getTime())))].sort((a, b) => a - b);

  const datasets = resultados.map((r, i) => {
    const cor = PALETA[i % PALETA.length];
    const porTempo = new Map(r.medidas.datas.map((d, j) => [d.getTime(), r.medidas[g.campo][j]]));
    const data = tempos.map(t => ({ x: t, y: porTempo.has(t) ? g.valor(porTempo.get(t)) : null }));

    return {
      label: r.nomeCidade,
      data,
      borderColor: cor,
      borderWidth: 2.5 * escala,
      tension: 0.25,
      spanGaps: false,
      pointRadius: 0,
      pointHoverRadius: 5 * escala,
      pointHitRadius: 8 * escala,
      pointBackgroundColor: cor,
      pointBorderColor: "#FFFFFF",
      pointHoverBorderWidth: 2 * escala,
      clip: false,
      fill: varias ? false : "start",
      // 1 cidade: área com gradiente da primária (25% → 0%)
      backgroundColor: varias ? cor : (ctx => {
        const area = ctx.chart.chartArea;
        if (!area) return hexParaRgba(cor, 0);
        const grad = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
        grad.addColorStop(0, hexParaRgba(cor, 0.25));
        grad.addColorStop(1, hexParaRgba(cor, 0));
        return grad;
      })
    };
  });

  const ultimaData = new Date(tempos[tempos.length - 1]);
  const fonte = (tamanho, peso = 400, familia = FONTE_GRAFICO) => ({ family: familia, size: tamanho * escala, weight: peso });
  const titulo = varias ? g.titulo : `${g.titulo} em ${resultados[0].nomeCidade}`;

  return {
    type: "line",
    data: { datasets },
    plugins: [pluginFundoBranco, pluginUltimoPonto, pluginCidades],
    options: {
      responsive: escala === 1,
      maintainAspectRatio: false,
      animation: escala === 1 ? { duration: 400 } : false,
      devicePixelRatio: escala === 1 ? undefined : 1,
      layout: { padding: { top: 4 * escala, right: 16 * escala, bottom: 4 * escala, left: 4 * escala } },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "time",
          min: tempos[0],
          max: new Date(ultimaData.getFullYear() + 1, 0, 1).getTime(), // vai até o próximo ano (ex.: 2027)
          time: { unit: "year", displayFormats: { year: "yyyy" }, tooltipFormat: "MM/yyyy" },
          ticks: { font: fonte(12), color: "#555A60", maxRotation: 0 },
          grid: { display: false },
          border: { color: "#9AA0A6", width: 1 * escala }
        },
        y: {
          title: { display: true, text: g.eixoY, font: fonte(12, 600), color: "#3C4043" },
          ticks: { font: fonte(12), color: "#555A60", padding: 6 * escala },
          grid: { color: "#ECEDF0", lineWidth: 1 * escala, drawTicks: false },
          border: { display: false }
        }
      },
      plugins: {
        title: {
          display: true, text: titulo, align: "start",
          font: fonte(16, 700, FONTE_TITULO), color: "#1E1E1E",
          padding: { top: 4 * escala, bottom: (varias ? 2 : 12) * escala }
        },
        cidades: {
          texto: varias ? resultados.map(r => r.nomeCidade).join(" · ") : "",
          tamanho: 13 * escala, espaco: 10 * escala, recuo: 0
        },
        subtitle: {
          display: true, text: FONTE_RODAPE, position: "bottom", align: "start",
          font: fonte(11), color: "#5F6368", padding: { top: 12 * escala }
        },
        legend: {
          display: varias, position: "top", align: "start",
          labels: { font: fonte(12), color: "#1E1E1E", boxWidth: 14 * escala, boxHeight: 3 * escala, padding: 14 * escala }
        },
        tooltip: {
          enabled: escala === 1,
          callbacks: {
            title: () => "",
            label: item => {
              const prefixo = varias ? `${item.dataset.label} · ` : "";
              return `${prefixo}${dataParaTexto(new Date(item.parsed.x))}: ${g.texto(item.parsed.y)}`;
            }
          }
        },
        ultimoPonto: { escala, texto: g.texto }
      }
    }
  };
}

// 2.9 Destrói os charts anteriores e desenha os 3
function desenharGraficos(resultados) {
  charts.forEach(c => c.destroy());
  charts = GRAFICOS.map((g, i) => new Chart(document.getElementById(`g${i + 1}`), montarConfig(g, resultados)));
  ultimosResultados = resultados;
  document.getElementById("aviso-absoluto").hidden = resultados.length < 2;
}

// PNG 3000×1500 (10×5 pol a 300 dpi), fundo branco
function baixarPNG(i) {
  const g = GRAFICOS[i];
  const canvas = document.createElement("canvas");
  canvas.width = 3000;
  canvas.height = 1500;
  canvas.style.cssText = "position:fixed; left:-10000px; top:0; width:3000px; height:1500px;";
  document.body.appendChild(canvas);

  const chart = new Chart(canvas, montarConfig(g, ultimosResultados, 3.75));
  canvas.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = g.arquivo;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    chart.destroy();
    canvas.remove();
  }, "image/png");
}

// ===================== 4. Interface =====================

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
             "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const MAX_CIDADES = 6;

const $ = id => document.getElementById(id);
const campoCidade = $("cidade");
const campoUf = $("uf");

// Chips: Betim/MG já vem adicionada
let chips = [{ cidade: "Betim", uf: "MG", codigo: 3106705, nome: "Betim/MG" }];

function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Código estilo Colab ---
function atualizarCodigo() {
  const codigo =
    `cidade = "${campoCidade.value}"  #@param {type:"string"}\n` +
    `uf = "${campoUf.value.toUpperCase()}"  #@param {type:"string"}\n` +
    `pix_na_cidade(cidade, uf)`;
  const el = $("codigo").querySelector("code");
  el.textContent = codigo;
  el.removeAttribute("data-highlighted");
  if (window.hljs) hljs.highlightElement(el);
}

$("mostrar-codigo").addEventListener("click", () => {
  const bloco = $("codigo");
  bloco.hidden = !bloco.hidden;
  $("mostrar-codigo").textContent = bloco.hidden ? "Mostrar código" : "Ocultar código";
  $("mostrar-codigo").setAttribute("aria-expanded", String(!bloco.hidden));
});

campoCidade.addEventListener("input", atualizarCodigo);
campoUf.addEventListener("input", () => {
  // Força maiúsculas mantendo o cursor
  const pos = campoUf.selectionStart;
  campoUf.value = campoUf.value.toUpperCase().replace(/[^A-Z]/g, "");
  campoUf.setSelectionRange(pos, pos);
  limparErroUf();
  atualizarCodigo();
});

// --- Validação ---
function limparErroUf() {
  $("uf-erro").hidden = true;
  campoUf.removeAttribute("aria-invalid");
}

function lerCampos() {
  const cidade = campoCidade.value.trim();
  const uf = campoUf.value.trim().toUpperCase();
  if (!UFS.includes(uf)) {
    $("uf-erro").textContent = "UF inválida. Use uma das 27 siglas (ex.: MG, SP, DF).";
    $("uf-erro").hidden = false;
    campoUf.setAttribute("aria-invalid", "true");
    campoUf.focus();
    return null;
  }
  if (!cidade) {
    mostrarAvisoForm("Digite o nome de uma cidade.");
    campoCidade.focus();
    return null;
  }
  limparErroUf();
  return { cidade, uf };
}

function mostrarAvisoForm(texto) {
  $("aviso-form").textContent = texto;
  $("aviso-form").hidden = !texto;
}

// --- Chips ---
function desenharChips() {
  let n = 0; // a cor segue a ordem das cidades válidas, igual aos gráficos
  $("chips").innerHTML = chips.map((c, i) => `
    <li class="chip ${c.codigo === null ? "chip-invalida" : ""}">
      ${c.codigo === null ? "" : `<span class="chip-cor" style="background:${PALETA[n++ % PALETA.length]}"></span>`}
      ${escapar(c.nome)}${c.codigo === null ? " <small>(não encontrada)</small>" : ""}
      <button type="button" data-remover="${i}" aria-label="Remover ${escapar(c.nome)}">×</button>
    </li>`).join("");
}

$("chips").addEventListener("click", e => {
  const botao = e.target.closest("[data-remover]");
  if (!botao) return;
  chips.splice(Number(botao.dataset.remover), 1);
  desenharChips();
});

$("adicionar").addEventListener("click", async () => {
  mostrarAvisoForm("");
  const entrada = lerCampos();
  if (!entrada) return;
  if (chips.length >= MAX_CIDADES) return mostrarAvisoForm(`Máximo de ${MAX_CIDADES} cidades.`);

  const botao = $("adicionar");
  botao.disabled = true;
  try {
    const log = [];
    const codigo = await buscarCodigo(entrada.cidade, entrada.uf, log);
    const nome = `${titleCase(entrada.cidade)}/${entrada.uf}`;
    const repetida = codigo === null
      ? chips.some(c => c.codigo === null && c.nome === nome)
      : chips.some(c => c.codigo === codigo);
    if (repetida) {
      mostrarAvisoForm(`${nome} já está na lista.`);
    } else {
      // Cidade não encontrada entra marcada: ao executar, mostra só a linha de log dela
      chips.push({ ...entrada, codigo, nome });
      desenharChips();
      if (codigo === null) mostrarAvisoForm(log[0]);
    }
  } catch (erro) {
    mostrarAvisoForm(erro.message);
  } finally {
    botao.disabled = false;
  }
});

// --- Executar ---
$("form").addEventListener("submit", async e => {
  e.preventDefault(); // Enter no campo também cai aqui
  mostrarAvisoForm("");

  let lista;
  if (chips.length) {
    lista = chips.map(c => ({ cidade: c.cidade, uf: c.uf }));
  } else {
    const entrada = lerCampos();
    if (!entrada) return;
    lista = [entrada];
  }

  carregando(true);
  try {
    // Mostra cada cidade assim que ela termina
    await compararCidades(lista, mostrarResultados);
  } finally {
    carregando(false);
  }
});

// Spinner com cronômetro
let cronometro = null;
function carregando(sim) {
  $("carregando").hidden = !sim;
  $("executar").disabled = sim;
  $("adicionar").disabled = sim;
  clearInterval(cronometro);
  if (sim) {
    const inicio = Date.now();
    const atualizar = () => {
      const s = Math.floor((Date.now() - inicio) / 1000);
      $("carregando-texto").textContent = `Buscando dados no Banco Central... ${s} s`;
    };
    atualizar();
    cronometro = setInterval(atualizar, 1000);
  }
}

// ===================== Resultado =====================

function mostrarResultados(resultados) {
  // Cor fixa por cidade = ordem das cidades válidas (igual em chips, tabela, perguntas e gráficos)
  const ok = resultados.filter(r => r.medidas);
  ok.forEach((r, i) => { r.cor = PALETA[i % PALETA.length]; });

  // Alertas de erro de API
  $("alertas").innerHTML = resultados.filter(r => r.erro).map(r => `
    <div class="alerta" role="alert">
      <strong>${escapar(r.nomeCidade)}: erro ao buscar dados</strong>
      ${r.erro.status ? `Status ${r.erro.status} · ${escapar(r.erro.api)}: ${escapar(r.erro.mensagem)}` : escapar(r.erro.message)}
    </div>`).join("");

  // 1. Terminal por cidade
  $("logs").innerHTML = resultados.map(r => {
    const linhas = r.log.map(l => {
      let classe = "linha";
      if (l.startsWith("Cidade não encontrada")) classe += " linha-destaque";
      else if (l.startsWith("  falhou")) classe += " linha-erro";
      else if (/tentativa|cache local|indisponível/.test(l)) classe += " linha-aviso";
      return `<span class="${classe}">${escapar(l)}</span>`;
    });
    if (r.erro) linhas.push(`<span class="linha linha-erro">Erro: ${escapar(r.erro.message)}</span>`);
    return `
      <div class="terminal">
        <div class="terminal-topo"><i></i><i></i><i></i><span>pix_na_cidade("${escapar(r.nomeCidade.split("/")[0])}", "${escapar(r.nomeCidade.split("/")[1])}")</span></div>
        <pre>${linhas.join("")}</pre>
      </div>`;
  }).join("");

  const temDados = ok.length > 0;
  $("bloco-kpis").hidden = !temDados;
  $("bloco-graficos").hidden = !temDados;
  $("bloco-perguntas").hidden = !temDados;
  if (!temDados) {
    charts.forEach(c => c.destroy());
    charts = [];
    return;
  }

  mostrarKpis(ok);
  desenharGraficos(ok);
  mostrarPerguntas(ok);
}

// Números no formato brasileiro
const num = (v, casas = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

function ultimoMes(r) {
  const m = r.medidas;
  const i = m.datas.length - 1;
  return {
    data: m.datas[i], pix: m.pix[i], pct: m.pct_populacao[i],
    ppp: m.pix_por_pessoa[i], vm: m.valor_medio[i]
  };
}

// 2. KPIs do último mês
function mostrarKpis(ok) {
  if (ok.length === 1) {
    const u = ultimoMes(ok[0]);
    $("kpis-titulo").textContent = `Último mês completo: ${dataParaTexto(u.data)} · ${ok[0].nomeCidade}`;
    $("kpis").innerHTML = `
      <div class="kpis">
        <div class="card kpi"><p class="kpi-valor">${num(u.pix)}</p><p class="kpi-rotulo">Pix feitos por pessoas no mês</p></div>
        <div class="card kpi"><p class="kpi-valor">${num(u.pct, 1)}%</p><p class="kpi-rotulo">da população fez Pix no mês</p></div>
        <div class="card kpi"><p class="kpi-valor">${num(u.ppp, 1)}</p><p class="kpi-rotulo">Pix por pessoa que usa</p></div>
        <div class="card kpi"><p class="kpi-valor">R$ ${num(u.vm, 2)}</p><p class="kpi-rotulo">valor médio de um Pix</p></div>
      </div>`;
    return;
  }

  $("kpis-titulo").textContent = "Último mês completo de cada cidade";
  const linhas = ok.map(r => ({ r, u: ultimoMes(r) }));
  const colunas = [
    { rotulo: "Cidade", chave: x => x.r.nomeCidade, mostra: x => `<span class="ponto-cor" style="background:${x.r.cor}"></span>${escapar(x.r.nomeCidade)} <small>(${dataParaTexto(x.u.data)})</small>` },
    { rotulo: "População", chave: x => x.r.populacao, mostra: x => num(x.r.populacao) },
    { rotulo: "Pix", chave: x => x.u.pix, mostra: x => num(x.u.pix) },
    { rotulo: "% população", chave: x => x.u.pct, mostra: x => `${num(x.u.pct, 1)}%` },
    { rotulo: "Pix/pessoa", chave: x => x.u.ppp, mostra: x => num(x.u.ppp, 1) },
    { rotulo: "R$/Pix", chave: x => x.u.vm, mostra: x => `R$ ${num(x.u.vm, 2)}` }
  ];
  let ordem = { col: -1, asc: true };

  function render() {
    const dados = [...linhas];
    if (ordem.col >= 0) {
      const k = colunas[ordem.col].chave;
      dados.sort((a, b) => {
        const va = k(a), vb = k(b);
        const cmp = typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb;
        return ordem.asc ? cmp : -cmp;
      });
    }
    $("kpis").innerHTML = `
      <div class="card tabela-card">
        <table>
          <thead><tr>${colunas.map((c, i) => `
            <th scope="col" aria-sort="${ordem.col === i ? (ordem.asc ? "ascending" : "descending") : "none"}">
              <button type="button" data-col="${i}">${c.rotulo}</button></th>`).join("")}</tr></thead>
          <tbody>${dados.map(x => `<tr>${colunas.map(c => `<td>${c.mostra(x)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
    $("kpis").querySelectorAll("[data-col]").forEach(b => b.addEventListener("click", () => {
      const col = Number(b.dataset.col);
      ordem = { col, asc: ordem.col === col ? !ordem.asc : true };
      render();
      $("kpis").querySelector(`[data-col="${col}"]`).focus();
    }));
  }
  render();
}

// 4. Perguntas a–d, uma coluna por cidade
function mostrarPerguntas(ok) {
  $("perguntas").innerHTML = ok.map(r => {
    const p = perguntas(r.medidas);
    return `
      <div class="card">
        <h3><span class="ponto-cor" style="background:${r.cor}"></span>${escapar(r.nomeCidade)}</h3>
        <dl>
          <dt>a) Primeiro mês com mais de 50% da população fazendo Pix</dt><dd>${p.a}</dd>
          <dt>b) Pix do último mês ÷ Pix de 12/2020</dt><dd>${p.b}</dd>
          <dt>c) Mês com mais Pix</dt><dd>${p.c}</dd>
          <dt>d) Valor médio de um Pix em 12/2020</dt><dd>${p.d}</dd>
        </dl>
      </div>`;
  }).join("");
}

// Botões de download
document.querySelectorAll("[data-baixar]").forEach(b =>
  b.addEventListener("click", () => baixarPNG(Number(b.dataset.baixar))));

// Início
$("autores").textContent = AUTORES;
desenharChips();
atualizarCodigo();
