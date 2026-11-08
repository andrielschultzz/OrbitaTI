-- Apaga a massa do ensaio do CQ-05 (volume-cq05.sql). O ON DELETE CASCADE de orbita.tenants leva usuários,
-- contatos, importações e lotes. A massa não cria nada em importacao.* (onde o cascade não chega).
\set ON_ERROR_STOP on
DELETE FROM orbita.tenants WHERE nome LIKE 'Ensaio CQ-05 %';
