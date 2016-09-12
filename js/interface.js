(function () {
  var templates = {
    menuOption: template('menuOption'),
    menuLink: template('menuLink'),
    menu: template('menu')

  };

  function template(name) {
    return Handlebars.compile($('#template-' + name).html());
  }

  Fliplet.DataSources.get({ type: 'menu' })
    .then(function (dataSources) {
      if (dataSources.length === 0) {
        $("#intial-holder").show();
      } else {
        $("#panel-holder").show();
      }

      dataSources.forEach(function (dataSource) {
        $('#select-menu').append(templates.menuOption(dataSource));
        $('#accordion').append(templates.menu(dataSource));

        Fliplet.DataSources.connect(dataSource.id)
          .then(function (source) {
            currentDataSource = source;
            return source.find();
          })
          .then(function (rows) {
            if (!rows || !rows.length) {
              return;
            }

            rows.forEach(function (row) {
              row.options = {
                label: true
              };

              $('#menu-' + dataSource.id).append(templates.menuLink(row));
              var linkActionProvider = Fliplet.Widget.open('com.fliplet.link', {
                selector: '[data-id='+ row.id +']  .link',
                data: {
                  action: row
                },
              });

            });
            console.log(rows);
          });
      });

      console.log(dataSources);
    });
})();

