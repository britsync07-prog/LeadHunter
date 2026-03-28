# Use the official Playwright image which includes Node.js and Headless Chromium
FROM mcr.microsoft.com/playwright:v1.50.1-jammy

# Define working directory
WORKDIR /usr/src/app

# Copy package requirements first for layer caching
COPY package*.json ./
COPY requirements.txt ./
COPY scripts/ ./scripts/

# Install Python 3, build tooling, and Chrome/Puppeteer runtime libraries
RUN apt-get update && apt-get install -y python3 python3-pip build-essential \
    && ./scripts/install_browser_deps.sh \
    && rm -rf /var/lib/apt/lists/*

# Install PM2 globally for production cluster mode
RUN npm install pm2 -g

# Install all Node & Python dependencies
RUN npm install
RUN ./scripts/install_python_deps.sh

# Install Playwright Chromium specifically (if not fully cached by the image)
RUN npx playwright install chromium

# Copy the rest of the application
COPY . .

# Expose the API and UI Dashboard Port
EXPOSE 3000

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=3000

# Start via PM2 runtime
CMD ["npm", "run", "start:prod"]
