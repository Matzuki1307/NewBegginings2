// Cargar las opciones en los selectores desde la API
document.addEventListener('DOMContentLoaded', async () => {
    // Función para cargar opciones en un select
    async function cargarOpciones(url, selectId) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            const select = document.getElementById(selectId);

            data.forEach(item => {
                const option = document.createElement('option');
                option.value = item.Id; // Guardar el ID
                option.textContent = item.Descripcion || item.Situacion; // Mostrar la descripción o situación
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

    // Cargar situaciones
    await cargarOpciones('/api/situaciones', 'situacion');

    // Cargar departamentos cuando se seleccione una situación
    const situacionSelect = document.getElementById('situacion');
    const departamentoSelect = document.getElementById('departamento');

    situacionSelect.addEventListener('change', async () => {
        // Habilitar el campo de departamentos
        departamentoSelect.disabled = false;

        // Limpiar opciones anteriores
        departamentoSelect.innerHTML = '<option value="" disabled selected>Selecciona tu departamento</option>';

        // Cargar departamentos (puedes ajustar la URL según tu backend)
        await cargarOpciones('/api/departamentos', 'departamento');
    });
});

// Enviar el formulario
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('formulario');

    form.addEventListener('submit', async function (event) {
        event.preventDefault(); // Evitar el comportamiento predeterminado del formulario

        // Recopilar los datos del formulario manualmente
        const data = {
            nombre: document.querySelector('[name="nombre"]').value,
            tipoId: document.querySelector('[name="tipoId"]').value,
            numeroId: document.querySelector('[name="numeroId"]').value,
            genero: document.querySelector('[name="genero"]').value,
            telefono: document.querySelector('[name="telefono"]').value,
            situacionId: document.querySelector('[name="situacionId"]').value,
            departamento: document.querySelector('[name="departamento"]').value, // Agregar el ID del departamento
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
                window.location.href = 'exito.html'; // Redirigir a exito.html si el envío es exitoso
            } else {
                alert('Hubo un error al enviar el formulario.');
            }
        } catch (error) {
            console.error('Error al enviar el formulario:', error);
            alert('No se pudo enviar el formulario.');
        }
    });
});
