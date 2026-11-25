// Gera a cópia offline dos dados (pasta data/). Roda uma vez no seu PC, sem servidor:
//   node scripts/gerar-snapshot.mjs
// Grava data/pix-{codigo}.json (Pix + população) e data/municipios-MG.json (para achar o código sem internet).
import { mkdir, writeFile } from "node:fs/promises";

const CIDADES = [
  { codigo: 3106705, nome: "Betim" },
  { codigo: 3147105, nome: "Pará de Minas" },
  { codigo: 3118601, nome: "Contagem" }
];
const UF = "MG";
const TENTATIVAS = 5;

const esperar = ms => new Promise(ok => setTimeout(ok, ms));

// GET com timeout de 180 s e várias tentativas (o Banco Central costuma falhar)
async function baixarJson(url, rotulo) {
  for (let t = 1; t <= TENTATIVAS; t++) {
    const inicio = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      const s = ((Date.now() - inicio) / 1000).toFixed(1);
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${s} s`);
      const json = await res.json();
      console.log(`  ${rotulo}: ok em ${s} s`);
      return json;
    } catch (e) {
      console.log(`  ${rotulo}: tentativa ${t} de ${TENTATIVAS} falhou (${e.message})`);
      if (t < TENTATIVAS) await esperar(3000 * t);
    }
  }
  throw new Error(`${rotulo}: não foi possível baixar`);
}

const urlPix = codigo => encodeURI(
  "https://olinda.bcb.gov.br/olinda/servico/Pix_DadosAbertos/versao/v1/odata/" +
  "TransacoesPixPorMunicipio(DataBase=@DataBase)?@DataBase='202011'&$format=json" +
  `&$filter=Municipio_Ibge eq ${codigo}` +
  "&$select=AnoMes,Municipio_Ibge,QT_PagadorPF,VL_PagadorPF,QT_PES_PagadorPF"
);

await mkdir("data", { recursive: true });

// Lista de municípios da UF (só id e nome)
const municipios = await baixarJson(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${UF}/municipios`, "IBGE municípios");
await writeFile(`data/municipios-${UF}.json`, JSON.stringify(municipios.map(m => ({ id: m.id, nome: m.nome }))));

// Uma cidade de cada vez
let falhas = 0;
for (const c of CIDADES) {
  console.log(`${c.nome}/${UF} (${c.codigo})`);
  try {
    const sidra = await baixarJson(`https://apisidra.ibge.gov.br/values/t/4709/n6/${c.codigo}/v/93/p/2022`, "SIDRA");
    const pix = await baixarJson(urlPix(c.codigo), "Banco Central");
    const arquivo = {
      gerado_em: new Date().toISOString(),
      codigo: c.codigo,
      municipio: c.nome,
      uf: UF,
      populacao: parseInt(sidra[1].V),
      value: pix.value
    };
    await writeFile(`data/pix-${c.codigo}.json`, JSON.stringify(arquivo, null, 1));
    console.log(`  gravado data/pix-${c.codigo}.json: ${pix.value.length} meses, população ${arquivo.populacao}`);
  } catch (e) {
    falhas++;
    console.log(`  ERRO: ${e.message}`);
  }
}
process.exit(falhas ? 1 : 0);
