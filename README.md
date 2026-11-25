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

## Arquivos

- `index.html` – página
- `style.css` – visual (identidade Una + formulário no estilo Colab)
- `app.js` – funções do notebook (`buscarCodigo`, `buscarPopulacao`, `buscarPix`, `prepararSerie`,
  `calcularMedidas`, `pixNaCidade`, `compararCidades`, `perguntas`, `desenharGraficos`) e a interface
- `img/una-logo.svg` – logo (opcional; sem ele aparece o wordmark "una")

Bibliotecas via CDN: Chart.js 4, chartjs-adapter-date-fns e highlight.js.

---

Davisson Henrique de Aguiar Silva · RA 62520519
