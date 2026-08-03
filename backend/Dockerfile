FROM php:8.2-cli

# PostgreSQL kliens és PDO kiterjesztések telepítése
RUN apt-get update && apt-get install -y \
    libpq-dev \
    && docker-php-ext-install pdo pdo_pgsql

WORKDIR /var/www/html

# Kód bemásolása
COPY . .

EXPOSE 8000

# PHP beépített szerver indítása
CMD ["php", "-S", "0.0.0.0:8000"]