if ! [[ -f "./static/bundle.js" ]]; then
	echo "Running 'npm run build' to build browserify files"
	npm run build
fi
node --trace-warnings index.js
