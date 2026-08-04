# syntax=docker/dockerfile:1
FROM php:8.3-cli

# libpq-dev  → required to build pdo_pgsql
# unzip, git → required by Composer to unpack packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    libpq-dev \
    unzip \
    git \
    && docker-php-ext-install pdo pdo_pgsql \
    && rm -rf /var/lib/apt/lists/*

# Composer, copied from the official image rather than installed by script
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Composer refuses to run as root without this, and the container is root
ENV COMPOSER_ALLOW_SUPERUSER=1

WORKDIR /var/www/html

# Dependencies are installed at runtime (`docker compose exec backend composer
# install`) because the source directory is bind-mounted over this one — a
# COPY here would be shadowed by the mount. For a production image without the
# mount, uncomment these to bake vendor/ into the layer:
#
# COPY composer.json composer.lock ./
# RUN composer install --no-dev --no-interaction --optimize-autoloader
# COPY . .

EXPOSE 8000

# 0.0.0.0, not localhost: a localhost binding inside the container is
# unreachable from the host no matter how ports are mapped.
CMD ["php", "-S", "0.0.0.0:8000", "-t", "/var/www/html"]
