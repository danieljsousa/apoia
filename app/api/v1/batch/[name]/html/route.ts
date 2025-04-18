import { Dao } from "@/lib/db/mysql"
import { Plugin, P, InfoDeProduto } from "@/lib/proc/combinacoes"
import { formatBrazilianDate, maiusculasEMinusculas, slugify } from "@/lib/utils/utils"
import { preprocess } from "@/lib/ui/preprocess"
import { fixText } from "@/lib/fix"
import { tua } from "@/lib/proc/tua"
import { getCurrentUser } from "@/lib/user"

export const maxDuration = 60

const computeScaledKeywords = (wordAndFrequency, max) => {
    const list = wordAndFrequency.filter(r => !r.hidden).sort((a, b) => b.count - a.count).map(r => [r.enum_item_descr, r.count]).slice(0, max)
    const listUnitary = list.map(r => r[1] as number / (list[0][1] as number)) as number[]
    const listUnitarySquared = listUnitary.map(r => r * r)
    const listUnitarySquaredSum = listUnitarySquared.reduce((acc, r) => acc + r, 0)
    const c = Math.sqrt(40000 / listUnitarySquaredSum)
    const listScaled = list.map((r, i) => [r[0], listUnitary[i] as number * c])
    const json = JSON.stringify(listScaled)
    return json
}

const preprocessAgrupamento = (text: string) => {
    if (!text) return '[Sem Agrupamento]'
    return text
}

/**
 * @swagger
 * 
 * /api/v1/batch/{name}/html:
 *   get:
 *     description: Obtem um relatório em HTML para um lote de processos
 *     tags:
 *       - batch
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         description: Nome do lote
 *     responses:
 *       200:
 *         description: Relatório em HTML
 */
export async function GET(req: Request, { params }: { params: { name: string } }) {
    const user = await getCurrentUser()
    if (!user) return Response.json({ errormsg: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const ungrouped = searchParams.get('ungrouped') === 'true'
    const batch_id = await Dao.assertIABatchId(params.name)
    const enum_id = await Dao.assertIAEnumId(Plugin.TRIAGEM)

    let html = ''

    const items = await Dao.retrieveByBatchIdAndEnumId(batch_id, enum_id)

    console.log('items', items.length)

    // use mais item if available
    for (const item of items)
        item.enum_item_descr = item.enum_item_descr_main || item.enum_item_descr

    const enumDescrs = items.reduce((acc, i) => {
        if (!acc.includes(i.enum_item_descr))
            acc.push(i.enum_item_descr)
        return acc
    }, [] as string[])
    console.log('enumDescrs', enumDescrs)
    if (!enumDescrs[0]) {
        const firstEnumDescr = enumDescrs.shift() as string
        if (ungrouped)
            enumDescrs.push(firstEnumDescr); // move '' to the end
    }
    const map = items.reduce((acc, i) => {
        acc[i.enum_item_descr] = acc[i.enum_item_descr] || []
        acc[i.enum_item_descr].push(i)
        return acc
    }, {})

    const triageItems = enumDescrs.map(d => ({ descr: d, items: map[d] }))

    html += `<h1>${params.name}</h1>`

    const palavrasChave = await Dao.retrieveCountByBatchIdAndEnumId(batch_id, await Dao.assertIAEnumId(Plugin.PALAVRAS_CHAVE))
    const palavrasChaveJson = computeScaledKeywords(palavrasChave, 100)

    const normas = await Dao.retrieveCountByBatchIdAndEnumId(batch_id, await Dao.assertIAEnumId(Plugin.NORMAS))
    const normasJson = computeScaledKeywords(normas, 100)

    // [['foo', 120], ['bar', 6]]

    html += `
        <div style="width: 100%; text-align: center;">
        <canvas id="keyword_canvas" width="1000" height="500"></canva>
        </div>
        <div style="width: 100%; text-align: center; margin-bottom: 3em;"><hr style="width: 50%"/>Nuvem de Palavras-Chave</div>

        <div style="width: 100%; text-align: center;">
        <canvas id="law_canvas" width="1000" height="500"></canva>
        </div>
        <div style="width: 100%; text-align: center;"><hr style="width: 50%"/>Nuvem de Normas</div>
        <script>
            WordCloud(document.getElementById('keyword_canvas'), { list: ${palavrasChaveJson},
                // gridSize: Math.round(16 * document.getElementById('keyword_canvas').offsetWidth / 1024),
                // weightFactor: function (size) {
                //     return Math.pow(size, 3) * document.getElementById('keyword_canvas').offsetWidth / 1024;
                // },
                fontFamily: 'Times, serif',
                shrinkToFit: true,
                rotateRatio: 0,
                rotationSteps: 1,
            });
            WordCloud(document.getElementById('law_canvas'), { list: ${normasJson},
                // gridSize: Math.round(16 * document.getElementById('keyword_canvas').offsetWidth / 1024),
                // weightFactor: function (size) {
                //     return Math.pow(size, 3) * document.getElementById('keyword_canvas').offsetWidth / 1024;
                // },
                fontFamily: 'Times, serif',
                shrinkToFit: true,
                rotateRatio: 0,
                rotationSteps: 1,
            });
        </script>`

    // index
    html += `<div class="page"><h2>Índice</h2>`
    html += `<table><thead><tr><th style="text-align: left">Grupo</th><th style="text-align: right">Quantidade</th></thead><tbody>`
    for (const ti of triageItems) {
        html += `<tr><td>${preprocessAgrupamento(ti.descr)}</td><td style="text-align: right"><a href="#${slugify(preprocessAgrupamento(ti.descr))}" style="color: #000000; text-decoration: none;">${ti.items.length}</a></td></tr>`
    }
    html += `</tbody>`
    html += `<tfoot><tr><th style="text-align: left">Total</th><th style="text-align: right">${triageItems.reduce((acc, t) => acc + t.items.length, 0)}</th></tr></tfoot>`
    html += `</table>`
    html += `</div>`

    const enumItens = await Dao.retrieveEnumItems()
    const enumMap = enumItens.reduce((acc, ei) => {
        acc[ei.enum_descr] = acc[ei.enum_descr] || []
        acc[ei.enum_descr].push({ descr: ei.enum_item_descr, descr_main: ei.enum_item_descr_main, hidden: ei.enum_item_hidden })
        return acc
    }, {})

    let count = 0
    for (const ti of triageItems) {
        html += `<div class="page"><h1><a id="${slugify(preprocessAgrupamento(ti.descr))}">${preprocessAgrupamento(ti.descr)}</a></h1><div>${ti.items.length} processos: `
        let i = 0
        for (const item of ti.items) {
            if (i) html += ', '
            html += item.dossier_code
            i++
        }
        html += `</div></div>`

        for (const item of ti.items) {
            const nomeDaClasse = tua[item.dossier_class_code]
            console.log('item', item)
            console.log('nomeDaClasse', nomeDaClasse)
            html += `<div class="page"><h1 class="titulo">Processo ${item.dossier_code}</h1>`
            html += `<div class="subtitulo">`
            if (nomeDaClasse) html += nomeDaClasse
            if (nomeDaClasse && item.dossier_filing_at) html += `<br/>`
            html += `Ajuizado em ${formatBrazilianDate(item.dossier_filing_at)}`
            html += `</div>`
            const generations = await Dao.retrieveGenerationByBatchDossierId(item.batch_dossier_id)
            for (const g of generations) {
                let text = g.generation
                if (g.descr === P.RESUMO) {
                    text = fixText(text, enumMap)
                }
                html += `<h2>${g.document_id ? maiusculasEMinusculas(g.descr) : g.descr}</h2><div class="ai-content">${preprocess(text, { kind: g.prompt, prompt: '' }, { textos: [] }, true)}</div>`
            }
            html += `</div>`
            html += `<hr style="margin-top: 2em;" />`
            html += `<div class="rodape">Este documento foi gerado pela ApoIA, ferramenta de inteligência artificial desenvolvida exclusivamente para facilitar a triagem de acervo, e não substitui a elaboração de relatório específico em cada processo, a partir da consulta manual aos eventos dos autos. Textos gerados por inteligência artificial podem conter informações imprecisas ou incorretas.</div>`
            count++
        }
    }
    console.log('count', count)

    return new Response(formated(html), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

}

const buildPDF = async (html: string, filename: string, disposition) => {
    const res = await fetch('https://siga.jfrj.jus.br/sigaex/public/app/util/html-pdf', {
        method: 'post',
        body: JSON.stringify({
            conv: '2',
            html: html
        }),
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        cache: 'no-store',
    })
    // const data = await res.json()
    const data = await res.json()

    const pdf = Buffer.from(data.pdf, 'base64')

    const headers = new Headers();
    headers.append("Content-Disposition", `${disposition}; filename="${filename}.pdf"`)
    headers.append("Content-Type", "application/pdf")
    headers.append("Content-Length", pdf.length.toString())

    return new Response(pdf, { headers })
}

const formated = (html: string) => {
    return `<html>
<head>
<script src="/wordcloud2.js"></script>
<style>
    button { display: none; }
    a.back-button { display: none; }
    h1 { text-align: center; }
    h2 { text-decoration: underline; }
    
    h1.titulo { margin-bottom: 0; }
    div.subtitulo {
        text-align: center;
    }
    div.rodape {
        text-align: center;
        font-size: 0.86rem;
    }
    
    div.ai-content h1 {
        text-align: left;
        font-size: 1.2rem;
        font-weight: bold;
        margin-top: 1rem;
    }

    div.ai-content h2 {
        font-size: 1.1rem;
        font-weight: bold;
        margin-top: 1rem;
        text-decoration: none;
    }

    div.ai-content h3 {
        font-size: 1.0rem;
        font-weight: bold;
        text-decoration: underline;
        margin-top: 1rem;
    }

    div.ai-content h4 {
        font-size: 1.0rem;
        font-weight: bold;
        margin-top: 1rem;
    }

    div.ai-content h5 {
        font-size: 1.0rem;
        font-weight: bold;
        margin-top: 1rem;
    }

    div.ai-content h6 {
        font-size: 1.0rem;
        text-decoration: underline;
        margin-top: 1rem;
    }

    div.ai-content p {
        margin-bottom: 0.5rem;
    }

    div.center {
        text-align: center;
    }
</style>
<style type="text/css" media="print">
    div.page {
        page-break-before: always;
    }
    div.page p {
        page-break-inside: avoid;
    }
</style>
</head>
<body>
<table style="width: 100%">
    <tr>
        <td style="width: 3em"><img src="https://apoia.vercel.app/apoia-logo-transp.png" style="height: 3em" alt="Apoia" /></td>
        <td align-left><span style="font-size: 150%">ApoIA</span><br/></td>
    </tr>
</table>




${html}

</body>
</html>`
}

