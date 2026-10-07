// Colores de la marca para el Tailwind del CDN (se carga después de cdn.tailwindcss.com)
tailwind.config = {
    theme: {
        extend: {
            colors: {
                primary: 'oklch(54.6% 0.245 262.881)',
                'primary-light': 'oklch(84.6% 0.12 262.881)',
                'primary-dark': 'oklch(44.6% 0.245 262.881)',
            }
        }
    }
};
