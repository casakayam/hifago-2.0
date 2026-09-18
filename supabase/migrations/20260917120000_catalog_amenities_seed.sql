-- Premier lot du référentiel d'équipements — ~48 items sur 16 catégories, choisis parmi les plus
-- universels et les plus pertinents à Guatapé (lac, Piedra del Peñol). Point de départ discutable,
-- pas la liste finale (~230 items recensés par la recherche du 2026-09-16/17) — des lots suivants
-- viendront en migrations séparées, `on conflict do nothing` pour rester purement additifs.
--
-- Migration de CONTENU distincte du schéma (20260917110000) — même précédent que
-- 20260908140000_catalog_tags_editorial.sql, une migration de contenu séparée de son schéma.
--
-- slugify() est la fonction Postgres partagée (20260817130000_product_creation_proposal.sql),
-- déjà appelée en RPC par le script mock — directement utilisable ici en SQL pur.

insert into catalog_amenity_categories (key, label, sort_order) values
  ('servicios_basicos',      jsonb_build_object('es', 'Servicios básicos',        'en', 'Basic services'),        10),
  ('internet_tech',          jsonb_build_object('es', 'Internet y tecnología',    'en', 'Internet & tech'),       20),
  ('bano',                   jsonb_build_object('es', 'Baño',                     'en', 'Bathroom'),              30),
  ('habitacion',             jsonb_build_object('es', 'Habitación',               'en', 'Room'),                  40),
  ('dormitorio_compartido',  jsonb_build_object('es', 'Dormitorio compartido',    'en', 'Shared dorm'),           50),
  ('cocina_comedor',         jsonb_build_object('es', 'Cocina y comedor',         'en', 'Kitchen & dining'),      60),
  ('climatizacion',          jsonb_build_object('es', 'Climatización',           'en', 'Climate control'),       70),
  ('lavanderia',             jsonb_build_object('es', 'Lavandería',               'en', 'Laundry'),               80),
  ('piscina_bienestar',      jsonb_build_object('es', 'Piscina y bienestar',      'en', 'Pool & wellness'),       90),
  ('entorno_vistas',         jsonb_build_object('es', 'Lago, entorno y vistas',   'en', 'Lake, surroundings & views'), 100),
  ('zonas_comunes',          jsonb_build_object('es', 'Zonas comunes',            'en', 'Common areas'),          110),
  ('entretenimiento',        jsonb_build_object('es', 'Entretenimiento',          'en', 'Entertainment'),         120),
  ('parqueadero_acceso',     jsonb_build_object('es', 'Parqueadero y acceso',     'en', 'Parking & access'),      130),
  ('recepcion',              jsonb_build_object('es', 'Recepción',               'en', 'Reception'),             140),
  ('seguridad',              jsonb_build_object('es', 'Seguridad',               'en', 'Safety'),                150),
  ('familia_ninos',          jsonb_build_object('es', 'Familia y niños',         'en', 'Family & kids'),         160),
  ('accesibilidad',          jsonb_build_object('es', 'Accesibilidad',           'en', 'Accessibility'),         170)
on conflict (key) do nothing;

insert into catalog_amenities (label, slug, category_key, recommended_level, often_paid, sort_order) values
  -- Servicios básicos
  (jsonb_build_object('es', 'Wifi', 'en', 'Wifi'), slugify('Wifi'), 'servicios_basicos', 'both', false, 10),
  (jsonb_build_object('es', 'Agua caliente', 'en', 'Hot water'), slugify('Agua caliente'), 'servicios_basicos', 'both', false, 20),
  (jsonb_build_object('es', 'Electricidad 24 horas', 'en', '24-hour electricity'), slugify('Electricidad 24 horas'), 'servicios_basicos', 'both', false, 30),
  -- Internet y tecnología
  (jsonb_build_object('es', 'Wifi de alta velocidad', 'en', 'High-speed wifi'), slugify('Wifi de alta velocidad'), 'internet_tech', 'both', false, 10),
  (jsonb_build_object('es', 'Caja fuerte', 'en', 'Safe box'), slugify('Caja fuerte'), 'internet_tech', 'lodging', false, 20),
  (jsonb_build_object('es', 'Enchufes cerca de la cama', 'en', 'Outlets near the bed'), slugify('Enchufes cerca de la cama'), 'internet_tech', 'lodging', false, 30),
  -- Baño
  (jsonb_build_object('es', 'Baño privado', 'en', 'Private bathroom'), slugify('Baño privado'), 'bano', 'lodging', false, 10),
  (jsonb_build_object('es', 'Baño compartido', 'en', 'Shared bathroom'), slugify('Baño compartido'), 'bano', 'lodging', false, 20),
  (jsonb_build_object('es', 'Secador de pelo', 'en', 'Hair dryer'), slugify('Secador de pelo'), 'bano', 'lodging', false, 30),
  (jsonb_build_object('es', 'Artículos de aseo', 'en', 'Toiletries'), slugify('Artículos de aseo'), 'bano', 'lodging', false, 40),
  -- Habitación
  (jsonb_build_object('es', 'Balcón', 'en', 'Balcony'), slugify('Balcón'), 'habitacion', 'lodging', false, 10),
  (jsonb_build_object('es', 'Aire acondicionado', 'en', 'Air conditioning'), slugify('Aire acondicionado'), 'habitacion', 'lodging', true, 20),
  (jsonb_build_object('es', 'Ropa de cama incluida', 'en', 'Bed linen included'), slugify('Ropa de cama incluida'), 'habitacion', 'lodging', false, 30),
  (jsonb_build_object('es', 'Armario', 'en', 'Closet'), slugify('Armario'), 'habitacion', 'lodging', false, 40),
  -- Dormitorio compartido
  (jsonb_build_object('es', 'Casillero con candado', 'en', 'Lockable locker'), slugify('Casillero con candado'), 'dormitorio_compartido', 'lodging', false, 10),
  (jsonb_build_object('es', 'Cortina de privacidad', 'en', 'Privacy curtain'), slugify('Cortina de privacidad'), 'dormitorio_compartido', 'lodging', false, 20),
  (jsonb_build_object('es', 'Enchufe individual', 'en', 'Individual outlet'), slugify('Enchufe individual'), 'dormitorio_compartido', 'lodging', false, 30),
  (jsonb_build_object('es', 'Lámpara de lectura', 'en', 'Reading light'), slugify('Lámpara de lectura'), 'dormitorio_compartido', 'lodging', false, 40),
  -- Cocina y comedor
  (jsonb_build_object('es', 'Cocina dotada', 'en', 'Equipped kitchen'), slugify('Cocina dotada'), 'cocina_comedor', 'both', false, 10),
  (jsonb_build_object('es', 'Nevera', 'en', 'Fridge'), slugify('Nevera'), 'cocina_comedor', 'both', false, 20),
  (jsonb_build_object('es', 'Microondas', 'en', 'Microwave'), slugify('Microondas'), 'cocina_comedor', 'both', false, 30),
  (jsonb_build_object('es', 'Cafetera', 'en', 'Coffee maker'), slugify('Cafetera'), 'cocina_comedor', 'both', false, 40),
  -- Climatización
  (jsonb_build_object('es', 'Ventilador', 'en', 'Fan'), slugify('Ventilador'), 'climatizacion', 'lodging', false, 10),
  (jsonb_build_object('es', 'Ventilador de techo', 'en', 'Ceiling fan'), slugify('Ventilador de techo'), 'climatizacion', 'lodging', false, 20),
  -- Lavandería
  (jsonb_build_object('es', 'Lavadora', 'en', 'Washing machine'), slugify('Lavadora'), 'lavanderia', 'establishment', false, 10),
  (jsonb_build_object('es', 'Servicio de lavandería', 'en', 'Laundry service'), slugify('Servicio de lavandería'), 'lavanderia', 'establishment', true, 20),
  (jsonb_build_object('es', 'Tendedero', 'en', 'Clothesline'), slugify('Tendedero'), 'lavanderia', 'establishment', false, 30),
  -- Piscina y bienestar
  (jsonb_build_object('es', 'Piscina privada', 'en', 'Private pool'), slugify('Piscina privada'), 'piscina_bienestar', 'both', false, 10),
  (jsonb_build_object('es', 'Piscina compartida', 'en', 'Shared pool'), slugify('Piscina compartida'), 'piscina_bienestar', 'establishment', false, 20),
  (jsonb_build_object('es', 'Jacuzzi', 'en', 'Jacuzzi'), slugify('Jacuzzi'), 'piscina_bienestar', 'both', true, 30),
  (jsonb_build_object('es', 'Gimnasio', 'en', 'Gym'), slugify('Gimnasio'), 'piscina_bienestar', 'establishment', false, 40),
  -- Lago, entorno y vistas
  (jsonb_build_object('es', 'Muelle privado', 'en', 'Private dock'), slugify('Muelle privado'), 'entorno_vistas', 'both', false, 10),
  (jsonb_build_object('es', 'Muelle compartido', 'en', 'Shared dock'), slugify('Muelle compartido'), 'entorno_vistas', 'establishment', false, 20),
  (jsonb_build_object('es', 'Vista al embalse', 'en', 'Reservoir view'), slugify('Vista al embalse'), 'entorno_vistas', 'both', false, 30),
  (jsonb_build_object('es', 'Vista a la Piedra del Peñol', 'en', 'Peñol Rock view'), slugify('Vista a la Piedra del Peñol'), 'entorno_vistas', 'both', false, 40),
  (jsonb_build_object('es', 'Acceso a la orilla', 'en', 'Waterfront access'), slugify('Acceso a la orilla'), 'entorno_vistas', 'establishment', false, 50),
  -- Zonas comunes
  (jsonb_build_object('es', 'Terraza', 'en', 'Terrace'), slugify('Terraza'), 'zonas_comunes', 'establishment', false, 10),
  (jsonb_build_object('es', 'Zona de hamacas', 'en', 'Hammock area'), slugify('Zona de hamacas'), 'zonas_comunes', 'establishment', false, 20),
  (jsonb_build_object('es', 'Sala de estar compartida', 'en', 'Shared lounge'), slugify('Sala de estar compartida'), 'zonas_comunes', 'establishment', false, 30),
  (jsonb_build_object('es', 'Jardín', 'en', 'Garden'), slugify('Jardín'), 'zonas_comunes', 'establishment', false, 40),
  -- Entretenimiento
  (jsonb_build_object('es', 'Mesa de póker', 'en', 'Poker table'), slugify('Mesa de póker'), 'entretenimiento', 'establishment', false, 10),
  (jsonb_build_object('es', 'Mesa de ping pong', 'en', 'Ping pong table'), slugify('Mesa de ping pong'), 'entretenimiento', 'establishment', false, 20),
  (jsonb_build_object('es', 'Cancha de tejo', 'en', 'Tejo court'), slugify('Cancha de tejo'), 'entretenimiento', 'establishment', false, 30),
  (jsonb_build_object('es', 'Parlante Bluetooth', 'en', 'Bluetooth speaker'), slugify('Parlante Bluetooth'), 'entretenimiento', 'establishment', false, 40),
  -- Parqueadero y acceso
  (jsonb_build_object('es', 'Parqueadero gratuito', 'en', 'Free parking'), slugify('Parqueadero gratuito'), 'parqueadero_acceso', 'establishment', false, 10),
  (jsonb_build_object('es', 'Parqueadero privado', 'en', 'Private parking'), slugify('Parqueadero privado'), 'parqueadero_acceso', 'establishment', true, 20),
  (jsonb_build_object('es', 'Acceso 24 horas', 'en', '24-hour access'), slugify('Acceso 24 horas'), 'parqueadero_acceso', 'establishment', false, 30),
  -- Recepción
  (jsonb_build_object('es', 'Recepción 24 horas', 'en', '24-hour reception'), slugify('Recepción 24 horas'), 'recepcion', 'establishment', false, 10),
  (jsonb_build_object('es', 'Check-in flexible', 'en', 'Flexible check-in'), slugify('Check-in flexible'), 'recepcion', 'establishment', false, 20),
  -- Seguridad
  (jsonb_build_object('es', 'Cámaras de seguridad', 'en', 'Security cameras'), slugify('Cámaras de seguridad'), 'seguridad', 'establishment', false, 10),
  (jsonb_build_object('es', 'Extintor', 'en', 'Fire extinguisher'), slugify('Extintor'), 'seguridad', 'both', false, 20),
  (jsonb_build_object('es', 'Botiquín de primeros auxilios', 'en', 'First aid kit'), slugify('Botiquín de primeros auxilios'), 'seguridad', 'establishment', false, 30),
  -- Familia y niños
  (jsonb_build_object('es', 'Cuna disponible', 'en', 'Crib available'), slugify('Cuna disponible'), 'familia_ninos', 'lodging', true, 10),
  (jsonb_build_object('es', 'Apto para niños', 'en', 'Child-friendly'), slugify('Apto para niños'), 'familia_ninos', 'both', false, 20),
  -- Accesibilidad
  (jsonb_build_object('es', 'Acceso sin escalones', 'en', 'Step-free access'), slugify('Acceso sin escalones'), 'accesibilidad', 'both', false, 10),
  (jsonb_build_object('es', 'Baño adaptado', 'en', 'Accessible bathroom'), slugify('Baño adaptado'), 'accesibilidad', 'lodging', false, 20)
on conflict (slug) do nothing;
