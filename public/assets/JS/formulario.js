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

    // Mostrar campos adicionales si la situación es "Desplazamiento forzado"
    const situacionSelect = document.getElementById('situacion');
    const camposAdicionales = document.getElementById('campos-adicionales');

    situacionSelect.addEventListener('change', () => {
        const seleccion = situacionSelect.options[situacionSelect.selectedIndex].text;

        if (seleccion === 'Desplazamiento forzado') {
            camposAdicionales.classList.remove('hidden');
        } else {
            camposAdicionales.classList.add('hidden');
        }
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
                window.location.href = 'ticket.html'; // Redirige a ticket.html
            } else {
                alert('Error al enviar el formulario.');
            }
        } catch (error) {
            console.error('Error al enviar el formulario:', error);
            alert('Ocurrió un error al procesar el formulario.');
        }
    });
});
