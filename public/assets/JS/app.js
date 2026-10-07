// Utilidades compartidas por las páginas internas (panel, gestión y administración)
const App = {
    usuario: null,

    // fetch con JSON. Si la sesión expiró, manda al login y regresa a esta página.
    // Si la respuesta no es exitosa, lanza un Error con el mensaje del servidor.
    async api(url, { method = 'GET', body } = {}) {
        const opciones = { method, headers: {} };
        if (body !== undefined) {
            opciones.headers['Content-Type'] = 'application/json';
            opciones.body = JSON.stringify(body);
        }
        const res = await fetch(url, opciones);
        if (res.status === 401) {
            window.location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
            throw new Error('Tu sesión expiró.');
        }
        let datos = null;
        try { datos = await res.json(); } catch (e) { /* respuesta sin cuerpo JSON */ }
        if (!res.ok) {
            const error = new Error((datos && datos.error) || 'Ocurrió un error. Intenta de nuevo.');
            error.status = res.status;
            error.datos = datos;
            throw error;
        }
        return datos;
    },

    // Carga el usuario logueado y pinta el encabezado común
    async iniciar() {
        this.usuario = await this.api('/api/me');
        this.pintarEncabezado();
        return this.usuario;
    },

    puede(permiso) {
        return Boolean(this.usuario && this.usuario.permisos.includes(permiso));
    },

    pintarEncabezado() {
        const header = document.getElementById('app-header');
        if (!header) return;
        const u = this.usuario;
        const iniciales = ((u.nombre || ' ')[0] + (u.apellido || ' ')[0]).trim().toUpperCase();
        const enlaces = [{ nombre: 'Panel', ruta: '/panel' }, ...u.tarjetas].map(t => {
            const activo = location.pathname === t.ruta;
            return `<a href="${t.ruta}" class="whitespace-nowrap px-3 py-2 rounded-md ${activo
                ? 'bg-blue-50 text-primary-dark font-semibold'
                : 'text-gray-600 hover:bg-gray-100'}">${this.escapar(t.nombre)}</a>`;
        }).join('');

        header.innerHTML = `
            <div class="bg-white border-b border-gray-200">
                <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
                    <a href="/" class="shrink-0"><img src="/assets/image/navbar-Logo3.png" alt="New Beginnings" class="h-10"></a>
                    <nav class="hidden lg:flex items-center gap-1 text-sm">${enlaces}</nav>
                    <div class="flex items-center gap-3">
                        <div class="text-right hidden sm:block">
                            <p class="text-sm font-medium text-gray-900">${this.escapar(u.nombre)} ${this.escapar(u.apellido)}</p>
                            <p class="text-xs text-gray-500">${this.escapar(u.rol)}</p>
                        </div>
                        <div class="h-9 w-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-semibold">${this.escapar(iniciales)}</div>
                        <a href="/logout" class="text-sm px-3 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100">Cerrar sesión</a>
                    </div>
                </div>
                <nav class="lg:hidden flex gap-1 overflow-x-auto px-4 pb-2 text-sm">${enlaces}</nav>
            </div>`;
    },

    // Evita que el texto escrito por usuarios se interprete como HTML
    escapar(texto) {
        return String(texto ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    },

    fecha(valor, conHora = false) {
        if (!valor) return '-';
        const opciones = { day: '2-digit', month: 'short', year: 'numeric' };
        if (conHora) Object.assign(opciones, { hour: '2-digit', minute: '2-digit' });
        return new Date(valor).toLocaleString('es-CO', opciones);
    },

    estadoBadge(estado) {
        const clases = {
            'Pendiente': 'bg-blue-100 text-blue-800',
            'En proceso': 'bg-amber-100 text-amber-800',
            'Resuelto': 'bg-green-100 text-green-800',
            'Cerrado': 'bg-gray-200 text-gray-700'
        }[estado] || 'bg-gray-100 text-gray-800';
        return `<span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${clases}">${this.escapar(estado)}</span>`;
    },

    // Mensaje flotante temporal
    aviso(mensaje, tipo = 'exito') {
        const div = document.createElement('div');
        div.className = `fixed bottom-4 right-4 z-50 max-w-sm px-4 py-3 rounded-lg shadow-lg text-sm text-white ${
            tipo === 'exito' ? 'bg-green-600' : 'bg-red-600'}`;
        div.setAttribute('role', 'status');
        div.textContent = mensaje;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 4000);
    },

    // Muestra u oculta un mensaje de error dentro de un contenedor
    error(elemento, mensaje) {
        elemento.textContent = mensaje || '';
        elemento.classList.toggle('hidden', !mensaje);
    }
};
