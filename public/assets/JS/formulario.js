 // Cargar las situaciones desde la API
 document.addEventListener('DOMContentLoaded', async () => {
    const selectSituacion = document.getElementById('situacion');

    try {
        const response = await fetch('/api/situaciones'); // Llamar a la API
        const situaciones = await response.json();

        // Agregar las opciones al select
        situaciones.forEach(situacion => {
            const option = document.createElement('option');
            option.value = situacion.id; // Usar el ID como valor
            option.textContent = situacion.situacion; // Mostrar el texto de la situación
            selectSituacion.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar las situaciones:', error);
    }
});

// Enviar el formulario
document.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault(); // Evita el envío predeterminado del formulario

    const data = {
        nombre: document.getElementById('nombre').value,
        tipoId: document.getElementById('tipo-id').value,
        numeroId: document.getElementById('numero-id').value,
        genero: document.getElementById('genero').value,
        telefono: document.getElementById('telefono').value,
        situacionId: document.getElementById('situacion').value // Enviar solo el ID de la situación
    };

    try {
        const response = await fetch('/api/formulario', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            alert('Formulario enviado con éxito.');
        } else {
            alert('Error al enviar el formulario.');
        }
    } catch (error) {
        console.error('Error al enviar el formulario:', error);
    }
});