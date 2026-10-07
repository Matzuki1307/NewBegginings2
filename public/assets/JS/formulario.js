// Cargar las opciones en los selectores desde la API
document.addEventListener('DOMContentLoaded', async () => {
    // Función para cargar opciones en un select
    async function cargarOpciones(url, selectId) {
        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Error al cargar las opciones: ${response.statusText}`);
            }

            const data = await response.json();
            const select = document.getElementById(selectId);

            data.forEach(item => {
                const option = document.createElement('option');
                option.value = item.Id; // Guardar el ID
                option.textContent = item.Situacion || item.Descripcion; // Mostrar la descripción o situación
                select.appendChild(option);
            });
        } catch (error) {
            console.error(`Error al cargar las opciones para ${selectId}:`, error);
        }
    }

    // Cargar géneros
    await cargarOpciones('/api/generos', 'genero');

    // Cargar tipos de identificación
    await cargarOpciones('/api/tipos-id', 'tipo-id');

    // Cargar departamentos
    await cargarOpciones('/api/departamentos', 'departamento');

    // Habilitar el campo "Departamento" cuando se carguen las opciones
    const departamentoSelect = document.getElementById('departamento');
    departamentoSelect.disabled = false;

    // Cargar situaciones
    await cargarOpciones('/api/situaciones', 'situacion');

    // Cargar unidades de medida
    await cargarOpciones('/api/unidades-medida', 'unidad-medida');

    // Aplicar la configuración de campos del rol: visible, habilitado y obligatorio
    const IDS_CAMPOS = {
        nombre: 'nombre', genero: 'genero', tipoId: 'tipo-id', numeroId: 'numero-id', telefono: 'telefono',
        situacionId: 'situacion', departamento: 'departamento', unidadMedida: 'unidad-medida', cantidad: 'cantidad'
    };
    try {
        const respuesta = await fetch('/api/formulario/campos');
        if (respuesta.ok) {
            const campos = await respuesta.json();
            campos.forEach(campo => {
                const elemento = document.getElementById(IDS_CAMPOS[campo.codigo]);
                if (!elemento) return;
                elemento.closest('.space-y-2').classList.toggle('hidden', !campo.visible);
                elemento.disabled = !campo.habilitado;
                elemento.required = campo.visible && campo.habilitado && campo.obligatorio;
                elemento.dataset.obligatorio = elemento.required;
            });
        }
    } catch (error) {
        console.error('Error al cargar la configuración de campos:', error);
    }

    // Mostrar campos adicionales si la situación es "Desplazamiento forzado"
    const situacionSelect = document.getElementById('situacion');
    const camposAdicionales = document.getElementById('campos-adicionales');

    situacionSelect.addEventListener('change', () => {
        const seleccion = situacionSelect.options[situacionSelect.selectedIndex].text;

        const esDesplazamiento = seleccion === 'Desplazamiento forzado';
        camposAdicionales.classList.toggle('hidden', !esDesplazamiento);

        // Unidad de medida y cantidad solo son obligatorias cuando se muestran
        ['unidad-medida', 'cantidad'].forEach(id => {
            const campo = document.getElementById(id);
            campo.required = esDesplazamiento && campo.dataset.obligatorio === 'true';
        });
    });
});

// Enviar el formulario
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('formulario');

    form.addEventListener('submit', async function (event) {
        event.preventDefault(); // Evitar el comportamiento predeterminado del formulario

        // Recopilar los datos del formulario manualmente
        const data = {
            nombre: document.getElementById('nombre').value,
            tipoId: document.getElementById('tipo-id').value,
            numeroId: document.getElementById('numero-id').value,
            genero: document.getElementById('genero').value,
            telefono: document.getElementById('telefono').value,
            situacionId: document.getElementById('situacion').value,
            departamento: document.getElementById('departamento').value,
            unidadMedida: document.getElementById('unidad-medida').value || null,
            cantidad: document.getElementById('cantidad').value || null
        };

        console.log('Datos enviados:', data); // Verificar los datos enviados

        try {
            const response = await fetch('/api/formulario', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (response.ok) {
                alert('Formulario enviado con éxito.');
                window.location.href = '/ticket'; // Redirige a ticket.html
            } else {
                // Muestra el motivo que da el servidor (datos faltantes o no permitidos)
                const resultado = await response.json().catch(() => ({}));
                alert(resultado.error || 'Error al enviar el formulario.');
            }
        } catch (error) {
            console.error('Error al enviar el formulario:', error);
            alert('Ocurrió un error al procesar el formulario.');
        }
    });
});
