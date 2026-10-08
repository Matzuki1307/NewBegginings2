// Estilo común de las gráficas (Chart.js) para Estadísticas y Modelado
const Graficos = {
    color: {
        acento: '#2a78d6',
        acentoSuave: 'rgba(42, 120, 214, 0.18)',
        gris: '#b4b3ad',
        texto: '#0b0b0b',
        textoSec: '#52514e',
        rejilla: '#ecebe7',
        eje: '#c8c7bf',
        // Estados (siempre acompañados de ícono y texto)
        bueno: '#0ca30c',
        advertencia: '#fab219',
        serio: '#ec835a',
        critico: '#d03b3b'
    },

    // Cada situación tiene siempre el mismo color en todas las gráficas
    situacion: {
        'Desplazamiento forzado': '#2a78d6',
        'Violencia contra la mujer': '#eb6834',
        'Maltrato intrafamiliar': '#1baf7a',
        'Sin dato': '#b4b3ad'
    },

    instancias: {},

    numero(valor, decimales = 0) {
        if (valor === null || valor === undefined || Number.isNaN(valor)) return '-';
        return Number(valor).toLocaleString('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    },

    configurar() {
        const d = Chart.defaults;
        d.font.family = getComputedStyle(document.body).fontFamily;
        d.font.size = 12;
        d.color = this.color.textoSec;
        d.maintainAspectRatio = false;
        d.plugins.legend.labels.usePointStyle = true;
        d.plugins.legend.labels.boxWidth = 8;
        d.plugins.legend.labels.boxHeight = 8;
        d.plugins.legend.labels.color = this.color.texto;
        Object.assign(d.plugins.tooltip, {
            backgroundColor: '#ffffff',
            titleColor: this.color.texto,
            bodyColor: this.color.textoSec,
            borderColor: '#e2e1dc',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            boxPadding: 4,
            usePointStyle: true
        });
        Chart.register(this.pluginEtiquetas, this.pluginReferencia);
    },

    // Ejes discretos: rejilla suave en el eje de valores y nada en el de categorías
    ejeValores(extra = {}) {
        return { grid: { color: this.color.rejilla }, border: { display: false }, ticks: { color: this.color.textoSec }, ...extra };
    },
    ejeCategorias(extra = {}) {
        return { grid: { display: false }, border: { color: this.color.eje }, ticks: { color: this.color.textoSec }, ...extra };
    },

    crear(id, config) {
        if (this.instancias[id]) this.instancias[id].destroy();
        this.instancias[id] = new Chart(document.getElementById(id), config);
        return this.instancias[id];
    },

    // Etiquetas de valor junto a las barras: dataset.etiqueta = (valor, índice) => texto
    // Con dataset.etiquetaDentro las escribe dentro de la barra (para barras apiladas)
    pluginEtiquetas: {
        id: 'etiquetas',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const horizontal = chart.options.indexAxis === 'y';
            chart.data.datasets.forEach((dataset, i) => {
                if (!dataset.etiqueta || !chart.isDatasetVisible(i)) return;
                chart.getDatasetMeta(i).data.forEach((barra, j) => {
                    const valor = dataset.data[j];
                    if (valor === null || valor === undefined) return;
                    const texto = dataset.etiqueta(valor, j);
                    if (!texto) return;
                    ctx.save();
                    ctx.font = `600 12px ${Chart.defaults.font.family}`;
                    if (dataset.etiquetaDentro) {
                        const ancho = Math.abs(barra.x - barra.base);
                        if (ctx.measureText(texto).width + 8 > ancho) { ctx.restore(); return; }
                        ctx.fillStyle = '#ffffff';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(texto, (barra.x + barra.base) / 2, barra.y);
                    } else if (horizontal) {
                        ctx.fillStyle = Graficos.color.texto;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(texto, barra.x + 6, barra.y);
                    } else {
                        ctx.fillStyle = Graficos.color.texto;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText(texto, barra.x, barra.y - 4);
                    }
                    ctx.restore();
                });
            });
        }
    },

    // Línea de referencia (meta) sobre el eje de valores: options.plugins.referencia = { valor, texto }
    pluginReferencia: {
        id: 'referencia',
        afterDatasetsDraw(chart, args, opciones) {
            if (!opciones || opciones.valor === undefined) return;
            const horizontal = chart.options.indexAxis === 'y';
            const escala = horizontal ? chart.scales.x : chart.scales.y;
            const { ctx, chartArea: area } = chart;
            const p = escala.getPixelForValue(opciones.valor);
            ctx.save();
            ctx.strokeStyle = Graficos.color.texto;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            if (horizontal) { ctx.moveTo(p, area.top); ctx.lineTo(p, area.bottom); }
            else { ctx.moveTo(area.left, p); ctx.lineTo(area.right, p); }
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = Graficos.color.texto;
            ctx.font = `600 11px ${Chart.defaults.font.family}`;
            // En barras horizontales el texto va encima del área (la gráfica deja espacio con layout.padding.top)
            if (horizontal) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(opciones.texto, p, area.top - 3); }
            else { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(opciones.texto, area.right, p - 4); }
            ctx.restore();
        }
    }
};
