import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mainRoutes from "./routes/main.js";
import { engine } from "express-handlebars";
import minifyHTML from "express-minify-html";
import minify from "express-minify";
import compression from "compression";
import mbkauth from "mbkauth";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const server = express();
server.use(mbkauth);
server.use(express.json());
server.use(compression());
server.use(minify());
server.use(
  minifyHTML({
    override: true,
    htmlMinifier: {
      removeComments: true,
      collapseWhitespace: true,
      removeAttributeQuotes: true,
      minifyCSS: true,
      minifyJS: true,
    },
  })
);
// Configure Handlebars
server.engine("handlebars", engine({
  defaultLayout: false,
  partialsDir: [
    path.join(__dirname, "views/templates"),
    path.join(__dirname, "views/notice"),
    path.join(__dirname, "views")
  ],
  cache: false,
  helpers: { // <-- ADD THIS helpers OBJECT
    eq: function (a, b) { // <-- Move your helpers inside here
      return a === b;
    },
    encodeURIComponent: function (str) {
      return encodeURIComponent(str);
    },
    formatTimestamp: function (timestamp) {
      return new Date(timestamp).toLocaleString();
    }, 
    truncate: function (str, len) {
      if (str && str.length > len) {
        return str.substring(0, len) + '...';
      }
      return str;
    }
  }
}));
server.set("view engine", "handlebars");
server.set("views", path.join(__dirname, "views"));
server.use(express.static('public'));

server.use('/Assets/Images', express.static(path.join(__dirname, 'Assets'), {
  maxAge: '1d' // Cache assets for 1 day
}));


server.get("/info/Terms&Conditions", (req, res) => {
  return res.render("staticPage/Terms&Conditions");
});

server.get("/info/FAQs", async (req, res) => {
  res.render("staticPage/FAQs");
});

server.get("/info/Credits", async (req, res) => {
  res.render("staticPage/Credits");
});

const rolesAndMembers = [
  {
    role: "Super Admin",
    members: ["Muhammad Bin Khalid", "Maaz Waheed"],
    description: "Top-level access",
  }
];

server.use("/", mainRoutes);

server.get('/simulate-error', (req, res, next) => {
  next(new Error('Simulated server error'));
});
/*
server.get("/custom/C", (req, res) => {
  return nextApp.render(req, res, "/Custom", req.query);
});
//It Render React Page, /pages
server.get("*", (req, res) => {
  return handleNext(req, res);
});
*/

server.use((req, res) => {
  console.log(`Path not found: ${req.url}`);
  return res.render("staticPage/404");
});

server.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500);
  res.render('templates/Error/500', { error: err });
});

const port = 3033;

// Start the server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
export default server;
/*
});
*/