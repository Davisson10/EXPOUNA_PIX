# Pix na cidade

Projeto acadêmico do Centro Universitário Una (Sistemas Distribuídos e Mobile · ExpoUNA).
Versão web do notebook da prática: busca dados abertos do Pix por município e compara até 6 cidades.

Só frontend (HTML + CSS + JS puro), sem framework e sem build.

## Como rodar

```bash
npx serve .
```

Abra o endereço que aparecer no terminal (normalmente http://localhost:3000).

> Abrir o `index.html` direto (file://) não funciona bem: use um servidor local como o `serve`.

## De onde vêm os dados

| Etapa | API | O que pega |
|---|---|---|
| Código do município | IBGE Localidades `/api/v1/localidades/estados/{UF}/municipios` | `id` pelo nome |
| População | SIDRA tabela 4709, variável 93, 2022 | Censo 2022 |
| Pix | Banco Central, `Pix_DadosAbertos` / `TransacoesPixPorMunicipio` | `QT_PagadorPF`, `QT_PES_PagadorPF`, `VL_PagadorPF` |

As três APIs aceitam CORS (o Banco Central responde `Access-Control-Allow-Origin`), então o navegador
busca tudo direto, sem backend e sem proxy.

## Quando o Banco Central está lento

A API do Pix às vezes demora minutos ou responde 500/504. Por isso o app:

1. busca só os 5 campos usados (`$select`) e uma cidade de cada vez;
2. espera até 180 s por resposta e tenta 3 vezes (pausas de 3 s e 6 s);
3. guarda a resposta no `localStorage` (chave `pix_{codigo}_{AAAAMM}`, renovada todo mês);
4. se tudo falhar, usa a cópia salva em `data/pix-{codigo}.json`.

Para gerar ou atualizar a cópia salva (Betim, Pará de Minas e Contagem), rode uma vez:

```bash
node scripts/gerar-snapshot.mjs
```

Ele também grava `data/municipios-MG.json`, para o app achar o código IBGE sem internet.
Sem internet, abra a página uma vez antes com internet, para o navegador guardar as bibliotecas do CDN.

## Arquivos

- `index.html` – página
- `style.css` – visual (identidade Una + formulário no estilo Colab)
- `app.js` – funções do notebook (`buscarCodigo`, `buscarPopulacao`, `buscarPix`, `prepararSerie`,
  `calcularMedidas`, `pixNaCidade`, `compararCidades`, `perguntas`, `desenharGraficos`) e a interface
- `img/una-65anos.png` – logo do cabeçalho (opcional; sem ele aparece o texto "65 ANOS ›una")
- `scripts/gerar-snapshot.mjs` – baixa a cópia offline para `data/`
- `data/` – cópia offline dos dados

Bibliotecas via CDN: Chart.js 4, chartjs-adapter-date-fns e highlight.js.

---

Davisson Henrique de Aguiar Silva · RA 62520519
