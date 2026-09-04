.PHONY: install dev start test lint build dist-linux dist-mac dist-win

install:
	npm install

dev:
	npm run dev

start:
	npm start

test:
	npm test

lint:
	npm run lint

build:
	npm run build

dist-linux:
	npm run dist:linux

dist-mac:
	npm run dist:mac

dist-win:
	npm run dist:win
