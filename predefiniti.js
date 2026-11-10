'use strict';
/*
 * Reparti e prodotti con cui l'app parte la prima volta.
 * Ordine dei reparti = percorso nel supermercato (modificabile poi dall'app).
 * Per aggiungere prodotti: separali con una virgola.
 */
const PREDEFINITI = [
  ['Pane', 'Pane, Pane integrale, Pane in cassetta, Pancarré, Panini, Baguette, Focaccia, Piadina, Grissini, Crackers, Taralli, Friselle, Pangrattato, Tramezzini, Pane per hamburger'],
  ['Farina e pasta', 'Farina, Farina 00, Farina integrale, Semola, Lievito, Lievito di birra, Pasta, Spaghetti, Penne, Fusilli, Rigatoni, Linguine, Mezze maniche, Farfalle, Lasagne, Pasta all\'uovo, Riso, Riso basmati, Riso per risotto, Couscous, Orzo, Farro, Polenta, Lenticchie, Ceci, Fagioli, Passata di pomodoro, Pelati, Polpa di pomodoro, Sugo pronto, Pesto'],
  ['Colazione', 'Biscotti, Fette biscottate, Cereali, Muesli, Corn flakes, Caffè, Caffè in cialde, Caffè in capsule, Tè, Tisane, Camomilla, Orzo solubile, Cacao, Zucchero, Marmellata, Miele, Nutella, Crema spalmabile, Merendine, Cornetti, Plumcake, Crostatine, Fiocchi d\'avena, Gallette di riso'],
  ['Latte e uova', 'Latte, Latte intero, Latte parzialmente scremato, Latte scremato, Latte senza lattosio, Latte di soia, Latte di avena, Bevanda vegetale, Uova, Burro, Yogurt, Yogurt greco, Yogurt bianco, Panna, Panna da cucina, Besciamella, Kefir'],
  ['Formaggi', 'Parmigiano, Grana, Pecorino, Formaggio grattugiato, Mozzarella, Mozzarella di bufala, Burrata, Stracciatella, Ricotta, Stracchino, Crescenza, Squacquerone, Scamorza, Provola, Gorgonzola, Fontina, Asiago, Taleggio, Emmental, Edamer, Feta, Mascarpone, Formaggio spalmabile, Philadelphia, Sottilette, Caciotta, Provolone'],
  ['Banco fresco', 'Prosciutto, Prosciutto crudo, Prosciutto cotto, Mortadella, Salame, Bresaola, Speck, Coppa, Pancetta, Guanciale, Wurstel, Affettati, Tortellini, Cappelletti, Ravioli, Gnocchi, Pasta fresca, Piadine fresche, Hummus, Olive'],
  ['Macelleria', 'Carne, Carne macinata, Macinato, Petto di pollo, Pollo, Cosce di pollo, Ali di pollo, Fesa di tacchino, Tacchino, Fettine, Fettine di vitello, Bistecca, Fiorentina, Salsiccia, Salsicce, Arrosto, Spezzatino, Hamburger, Polpette, Braciole, Lonza, Costine, Maiale, Vitello, Manzo, Coniglio, Agnello, Cotolette, Involtini, Scaloppine'],
  ['Pesce', 'Pesce, Orata, Branzino, Spigola, Salmone, Salmone affumicato, Merluzzo, Baccalà, Platessa, Sogliola, Pesce spada, Tonno fresco, Sgombro, Alici, Sarde, Gamberi, Gamberoni, Mazzancolle, Scampi, Cozze, Vongole, Calamari, Totani, Polpo, Seppie, Surimi'],
  ['Frutta e verdura', 'Frutta, Verdura, Mele, Pere, Banane, Arance, Arance da spremuta, Mandarini, Clementine, Limoni, Lime, Kiwi, Uva, Fragole, Pesche, Albicocche, Ciliegie, Prugne, Fichi, Cachi, Anguria, Melone, Ananas, Frutti di bosco, Mirtilli, Avocado, Broccoli, Cavolfiore, Cavolo nero, Verza, Cavolini di Bruxelles, Zucchine, Melanzane, Peperoni, Pomodori, Pomodorini, Insalata, Lattuga, Insalata in busta, Rucola, Radicchio, Spinaci, Bietole, Cicoria, Carote, Cipolle, Cipollotti, Aglio, Patate, Sedano, Finocchi, Funghi, Zucca, Cetrioli, Carciofi, Asparagi, Porri, Fagiolini, Piselli, Fave, Prezzemolo, Basilico, Rosmarino, Zenzero, Peperoncino, Frutta secca, Noci, Mandorle'],
  ['Saponi persona', 'Shampoo, Balsamo, Bagnoschiuma, Docciaschiuma, Sapone mani, Sapone liquido, Saponetta, Dentifricio, Spazzolino, Filo interdentale, Collutorio, Deodorante, Assorbenti, Salvaslip, Rasoi, Lamette, Schiuma da barba, Crema corpo, Crema mani, Crema viso, Struccante, Dischetti di cotone, Cotton fioc, Cerotti, Salviette, Pannolini, Fazzoletti'],
  ['Saponi casa', 'Detersivo piatti, Detersivo lavatrice, Ammorbidente, Pastiglie lavastoviglie, Sale lavastoviglie, Brillantante, Candeggina, Sgrassatore, Anticalcare, Detersivo pavimenti, Detergente vetri, Detergente bagno, Spugne, Panno microfibra, Guanti, Carta igienica, Carta da cucina, Scottex, Tovaglioli, Sacchetti spazzatura, Sacchetti umido, Carta stagnola, Alluminio, Pellicola, Carta forno, Sacchetti gelo'],
];

// Restituisce { reparti, prodotti } nel formato dell'app.
function datiPredefiniti(keyOf) {
  const reparti = {}, prodotti = {};
  PREDEFINITI.forEach(([nome, elenco], i) => {
    const id = 'rp' + String(i + 1).padStart(2, '0');
    reparti[id] = { n: nome, pos: i };
    for (const p of elenco.split(',').map(s => s.trim()).filter(Boolean)) {
      const k = keyOf(p);
      if (!prodotti[k]) prodotti[k] = { n: p, r: id };
    }
  });
  return { reparti, prodotti };
}
